import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { logError } from '@/lib/observability'
import { decidirBaixa, JANELA_BAIXA, JANELA_CONFERIR, recebeCategoria, type CandidatoLivro } from '@/lib/financeiro/livro-baixa'
import {
  candidatosLivro, ContaAlterada, contasDaAR, dinheiroDaAR, exigirTravadas, hojeSP, nomeCategoria, posAjuste, travarContas,
} from '@/lib/financeiro/livro-baixa-db'
import { compensado, ondeRef } from '@/lib/financeiro/livro'
import { categoriaReceitaPadraoId } from '@/lib/financeiro/categoria-receita-padrao'
import { CATEGORIA_RECEITA_SERVICOS } from '@/lib/financeiro/livro-categorias'

// Lançamento do livro foi ligado por outra baixa concorrente → desfaz a $transaction desta AR.
class LivroJaLigado extends Error {}
// Fix 7 (F7-E, #5): status de Payment Asaas sem dinheiro a caminho (não pago ou já desfeito); qualquer outro (CONFIRMED,
// DISPUTED, REFUND_PENDING, AWAITING_*, CHARGEBACK_*, RECEIVED sem crédito) é dinheiro que só entra pela linha do extrato.
// EXPIRED e FAILED são como PENDING (a cobrança não foi paga; o cliente pode ter pago por fora).
const ASAAS_SEM_DINHEIRO = ['PENDING', 'OVERDUE', 'DELETED', 'CANCELLED', 'REFUNDED', 'EXPIRED', 'FAILED']
const AVISO_ASAAS_EM_TRANSITO = 'pagamento Asaas ainda não creditado/em disputa: o dinheiro entra pela linha do extrato'
// Fix 6 (F6-B, #2): o Conferir nunca cria dinheiro Asaas — sem a linha do extrato, só confere e avisa.
const AVISO_ASAAS_SEM_LINHA =
  'pagamento Asaas sem lançamento: o dinheiro entra pela linha do extrato Asaas (ou já está no ajuste de caixa, se anterior ao corte)'

// Resultado de cada AR: erro (vai em erros), pular (sem valor; não conta), ligada / delta de saldo, aviso (vai em avisos).
type ResultadoAR = { erro?: string; pular?: boolean; ligada?: boolean; delta?: number; aviso?: string }

// Onda 4 (§8): corpo validado — id que não é texto não chega mais ao banco (era 500). Vínculo explícito AR → lançamento
// do livro (rotina): { [arId]: transactionId }.
const IDS_OBRIGATORIO = 'ids é obrigatório (array não vazio)'
const RECONCILED_OBRIGATORIO = 'reconciled é obrigatório (boolean true/false)'
const bodySchema = z.object({
  ids: z
    .array(z.string({ invalid_type_error: 'ids deve ser uma lista de ids (texto)' }).min(1, 'ids deve ser uma lista de ids (texto)'), {
      required_error: IDS_OBRIGATORIO, invalid_type_error: IDS_OBRIGATORIO,
    })
    .min(1, IDS_OBRIGATORIO)
    .max(200, 'Máximo 200 itens por operação'),
  reconciled: z.boolean({ required_error: RECONCILED_OBRIGATORIO, invalid_type_error: RECONCILED_OBRIGATORIO }),
  livro: z.record(z.string()).optional(),
})

/**
 * Wave S (audit 2026-05-24): POST /api/financeiro/contas-receber/bulk-reconcile
 *
 * Karlão pediu: filtro + bulk reconcile pra não abrir uma a uma. Operador
 * marca várias contas como conciliadas (após conferir extrato bancário) de
 * uma vez só.
 *
 * Body: { ids: string[], reconciled: boolean, livro?: Record<arId, transactionId> }
 * 30/10 (livro-razão): se a linha do banco já está no livro (origin BANCO, categoria fallback),
 * a baixa LIGA a ela (linked_ref) em vez de criar outra transação — saldo não muda.
 * - reconciled=true → status vira LIQUIDADO + cria Transaction CREDIT + balance++
 * - reconciled=false → só desmarca (fix 10, F10-A): status volta pra RECEBIDO; nenhum lançamento nem saldo muda
 *
 * Regra Karlão (2026-06-02): "saldo só muda quando ADM confere no banco".
 * RECEBIDO = alegação (cliente/funcionário disse). LIQUIDADO = ADM conferiu
 * no extrato. Saldo só é atualizado na transição RECEBIDO → LIQUIDADO.
 * Asaas/webhooks continuam liquidando direto via webhook (banco já confirma).
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const lido = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!lido.success) {
      const primeiro = lido.error.errors[0]
      // `livro` inválido segue o contrato das rotas da rotina (422 'Dados inválidos'); ids/reconciled, 400 com o motivo.
      return primeiro?.path[0] === 'livro' ? handleError(lido.error) : error(primeiro?.message ?? 'Dados inválidos', 400)
    }
    const { ids, reconciled, livro } = lido.data

    // Daqui só saem os ids: tudo o que decide (status, valor, conta, lançamento existente) é relido
    // DENTRO da $transaction de cada AR, depois de travar a linha (E1).
    const arsToProcess = await prisma.accountReceivable.findMany({
      where: { id: { in: ids }, company_id: user.companyId, deleted_at: null },
      select: { id: true },
    })

    let updated = 0
    let ligadas = 0
    const erros: { ar: string; motivo: string }[] = []
    // Onda 4 (§5 iv): conferida, mas com sinal de duplicidade a resolver pelo Extrato.
    const avisos: { ar: string; motivo: string }[] = []
    let balanceDelta = 0  // pra retornar ao frontend confirmando o impacto

    // Loop por AR — cada uma com seu próprio account_id e amount.
    // $transaction atomic dentro do loop garante AR + Transaction + balance
    // são sempre consistentes pra cada AR individualmente.
    for (const { id: arId } of arsToProcess) {
      // Vínculo explícito pedido (só na conferência): se não puder ser feito, NÃO liquida — vai em erros (F11).
      const pedido = reconciled ? livro?.[arId] ?? null : null

      let resultado: ResultadoAR
      try {
        // Onda 4 (§7): a leitura de fora só diz QUAIS contas travar (a da AR + as dos lançamentos dela).
        const lida = await prisma.accountReceivable.findFirst({
          where: { id: arId, company_id: user.companyId, deleted_at: null },
          select: { id: true, account_id: true, pix_code: true },
        })
        const contas = lida ? await contasDaAR(prisma, user.companyId, lida) : []
        resultado = await prisma.$transaction(async (tx): Promise<ResultadoAR> => {
          // Ordem única de travas (§7): contas (accounts) → AR → transações. Receber, Desfazer, livro/linhas e outro
          // Conferir travam na mesma ordem, então esperam aqui (sem deadlock, #10) e a releitura enxerga o que comitaram (E1, #9).
          const travadas = await travarContas(tx, user.companyId, contas)
          await tx.$queryRaw`SELECT id FROM accounts_receivable WHERE id = ${arId} AND company_id = ${user.companyId} FOR UPDATE`
          const ar = await tx.accountReceivable.findFirst({
            where: { id: arId, company_id: user.companyId, deleted_at: null },
            select: {
              id: true, account_id: true, received_amount: true, total_amount: true, status: true, description: true,
              category_id: true, reconciled: true, grouped_into_id: true, pix_code: true,
            },
          })
          if (!ar) return { erro: 'conta a receber não encontrada' }
          exigirTravadas(travadas, [ar.account_id])
          // Onda 4 (§4): Desfazer só desfaz conta conferida — AR estornada/PENDENTE (#8) não perde crédito nem saldo.
          if (!reconciled && ar.reconciled !== true && ar.status !== 'LIQUIDADO') return { erro: 'conta não conferida' }
          // Conferir exige conta recebida (PAGO = status legado de recebida): PENDENTE não vira LIQUIDADO nem ganha crédito.
          if (reconciled && ar.status !== 'RECEBIDO' && ar.status !== 'LIQUIDADO' && ar.status !== 'PAGO') return { erro: 'conta não recebida' }
          // Onda 4 (§5 i, #5): original de um agrupamento recebida pela agrupadora (sem valor próprio) — o dinheiro é da agrupadora.
          if (reconciled && ar.grouped_into_id && !ar.received_amount) return { erro: 'conta agrupada — confira a agrupadora' }

          const amount = ar.received_amount || ar.total_amount
          if (!amount) return pedido ? { erro: 'conta a receber sem valor; vínculo não feito' } : { pular: true }

          // Fix 6 (F6-B, #2, m10; substitui o F4-B (2)): Payment Asaas RECEIVED sem crédito pay_* — para o Asaas a LINHA
          // do extrato é o dinheiro e o Conferir NUNCA cria dinheiro Asaas (o pagamento anterior ao corte já está no ajuste
          // de caixa; o posterior entra pela linha, que nasce ligada ao pay_ — F6-A). (1) Linha ASAAS:PAY:<pay> livre em
          // qualquer conta → liga com linked_ref = pay, sem saldo; com livro[ar] = essa linha, idem, e o nocional AR:<id>
          // vivo na MESMA conta da linha (Receber manual) sai (SWAP) — sem comparar bruto × líquido. (2) Sem linha → só
          // LIQUIDADO + aviso. Vale com ou sem conta na AR.
          if (reconciled) {
            const recebidos = await tx.payment.findMany({
              where: { company_id: user.companyId, receivable_id: ar.id, provider: 'asaas', status: 'RECEIVED', external_id: { not: null } },
              select: { external_id: true },
            })
            const refsPay = recebidos.map((p) => p.external_id as string)
            const semCreditoPay = refsPay.length > 0 && (await tx.transaction.findFirst({
              where: { company_id: user.companyId, transaction_type: 'CREDIT', ...ondeRef(refsPay) },
              select: { id: true },
            })) === null
            const dinheiro = semCreditoPay ? await dinheiroDaAR(tx, user.companyId, ar) : null
            const SELECT_ASAAS_PAY = { id: true, account_id: true, category_id: true, source_text: true, bank_ref: true } as const
            const linhaPedida = semCreditoPay && pedido ? await tx.transaction.findFirst({
              where: { id: pedido, company_id: user.companyId, origin: 'BANCO', linked_ref: null, bank_ref: { in: refsPay.map((r) => `ASAAS:PAY:${r}`) } },
              select: SELECT_ASAAS_PAY,
            }) : null
            // Fix 8 (F8-E, m5/m6): com a linha pedida, dinheiro desta AR em OUTRA conta (Receber manual no Caixa/Itaú) é
            // possível duplicidade — como produção, não liga: devolve o erro para alguém conferir.
            if (linhaPedida && dinheiro) {
              const fora = [...new Set([...dinheiro.linhas, ...dinheiro.nocionais].map((t) => t.account_id))].filter((c) => c !== linhaPedida.account_id)
              if (fora.length > 0) {
                const nomes: { id: string; name: string | null }[] = await tx.account.findMany({ where: { company_id: user.companyId, id: { in: fora } }, select: { id: true, name: true } })
                return { erro: `há dinheiro desta conta em ${fora.map((c) => nomes.find((n) => n.id === c)?.name ?? c).join(', ')}; confira antes de ligar` }
              }
            }
            const semDinheiro = !!dinheiro && dinheiro.linhas.length === 0 && dinheiro.nocionais.length === 0
            const confirmada = !!dinheiro && dinheiro.refs.pagamentos.some((p) => p.provider === 'asaas' && p.status === 'CONFIRMED')
            if (linhaPedida || (!pedido && semDinheiro && !confirmada)) {
              const categoria = ar.category_id ?? await categoriaReceitaPadraoId(tx, user.companyId)
              const alvo = linhaPedida ? refsPay.filter((r) => `ASAAS:PAY:${r}` === linhaPedida.bank_ref) : refsPay
              let ligou = false
              let semLinha = false
              let delta = 0
              for (const ref of alvo) {
                const linha = linhaPedida ?? await tx.transaction.findFirst({
                  where: { company_id: user.companyId, origin: 'BANCO', bank_ref: `ASAAS:PAY:${ref}`, linked_ref: null },
                  select: SELECT_ASAAS_PAY,
                })
                if (!linha) {
                  semLinha = true
                  continue
                }
                exigirTravadas(travadas, [linha.account_id])
                const ligada = await tx.transaction.updateMany({
                  where: { id: linha.id, company_id: user.companyId, linked_ref: null },
                  data: {
                    linked_ref: ref,
                    ...(recebeCategoria(await nomeCategoria(tx, user.companyId, linha.category_id)) ? { category_id: categoria } : {}),
                    description: `LIQUIDACAO: ${ar.description} · banco: ${linha.source_text ?? ''}`,
                    reconciled: true,
                  },
                })
                if (ligada.count === 0) throw new LivroJaLigado()
                ligou = true
                if (linhaPedida) {
                  // m10: o Receber manual (nocional AR:<id>) na conta da linha é o mesmo dinheiro — sai com o saldo.
                  const proprios = await tx.transaction.findMany({
                    where: { company_id: user.companyId, account_id: linha.account_id, bank_ref: `AR:${ar.id}`, transaction_type: 'CREDIT', origin: null, source_text: null },
                    select: { id: true, amount: true, account_id: true, created_at: true },
                  })
                  const estornos = await tx.transaction.findMany({
                    where: { company_id: user.companyId, bank_ref: `AR:${ar.id}:estorno` },
                    select: { account_id: true, created_at: true },
                  })
                  // Fix 7 (F7-A): só o nocional posterior ao ajuste de caixa da conta.
                  for (const t of await posAjuste(tx, user.companyId, proprios.filter((c) => !compensado(c, estornos)))) {
                    await tx.transaction.delete({ where: { id: t.id } })
                    await tx.account.update({
                      where: { id: t.account_id },
                      data: { current_balance: { decrement: t.amount }, updated_at: new Date() },
                    })
                    delta -= t.amount
                  }
                }
              }
              await tx.accountReceivable.update({
                where: { id: ar.id, company_id: user.companyId },
                data: { reconciled: true, status: 'LIQUIDADO', updated_at: new Date() },
              })
              return { ligada: ligou, delta, ...(semLinha ? { aviso: AVISO_ASAAS_SEM_LINHA } : {}) }
            }
          }

          // 2026-06-03 fix (OS 60548): ARs antigas/portal sem account_id não conseguiam
          // ser desfeitas porque o loop pulava silenciosamente (updated=0).
          // Fix: quando account_id=null, só flipa flag+status (sem Transaction nem balance —
          // não havia o que reverter, pois nunca afetou conta bancária).
          if (!ar.account_id) {
            if (pedido) return { erro: 'conta a receber sem conta bancária; vínculo não feito' }
            await tx.accountReceivable.update({
              where: { id: ar.id, company_id: user.companyId },
              data: reconciled
                ? { reconciled: true, status: 'LIQUIDADO', updated_at: new Date() }
                : { reconciled: false, status: 'RECEBIDO', updated_at: new Date() },
            })
            return {}
          }

          if (reconciled) {
            // Onda 4 (§5): o que já é dinheiro desta AR (existing) — nocionais vivos AR:id e :anticipation (o já
            // compensado por :estorno não conta), créditos do adquirente/Asaas (Payment) e do CNAB (pix_code), e as
            // linhas do BANCO ligadas/convertidas a qualquer desses. Sem nada disso → decide ligar/criar.
            const { refs, linhas: linhasDaAR, nocionais } = await dinheiroDaAR(tx, user.companyId, ar)

            // Uma data só por AR: busca e decisão no mesmo dia mesmo se a meia-noite virar no meio.
            const hoje = hojeSP()
            const categoria = ar.category_id
              ?? await categoriaReceitaPadraoId(tx, user.companyId)
            const nomeAlvo = ar.category_id ? await nomeCategoria(tx, user.companyId, ar.category_id) : CATEGORIA_RECEITA_SERVICOS
            const liquidar = () => tx.accountReceivable.update({
              where: { id: ar.id, company_id: user.companyId },
              data: { reconciled: true, status: 'LIQUIDADO', updated_at: new Date() },
            })
            // Liga a linha do livro à AR — o dinheiro já está no saldo: NÃO cria transação nem mexe na conta.
            // Linha já categorizada (ex.: Venda de Servicos) mantém a sua categoria. Guard atômico: só se ainda livre.
            const ligar = async (linhaId: string, candidatos: CandidatoLivro[]) => {
              const alvo = await tx.transaction.findFirst({ where: { id: linhaId, company_id: user.companyId }, select: { source_text: true } })
              const linha = candidatos.find((c) => c.id === linhaId)
              const ligou = await tx.transaction.updateMany({
                where: { id: linhaId, company_id: user.companyId, linked_ref: null },
                data: {
                  linked_ref: `AR:${ar.id}`,
                  ...(recebeCategoria(linha?.categoria ?? null) ? { category_id: categoria } : {}),
                  description: `LIQUIDACAO: ${ar.description} · banco: ${alvo?.source_text ?? ''}`,
                  reconciled: true,
                },
              })
              if (ligou.count === 0) throw new LivroJaLigado()
            }

            if (linhasDaAR.length > 0 || nocionais.length > 0) {
              const pedidoJaLigado = !!pedido && linhasDaAR.some((l) => l.id === pedido)
              // Só o crédito do Receber/Conferir (AR:id, sem texto do banco) pode ser trocado pela linha do banco.
              const trocaveis = linhasDaAR.length === 0 && nocionais.every((t) => t.bank_ref === refs.proprio && t.source_text === null)
              if (pedido && !pedidoJaLigado) {
                if (!trocaveis) return { erro: 'conta a receber já tem lançamento; vínculo não feito' }
                // (iii) SWAP (#7): a linha pedida é o mesmo dinheiro do nocional → apaga o nocional (e o saldo), liga a linha.
                const candidatos = await candidatosLivro(tx, user.companyId, ar.account_id, 'CREDIT', hoje, pedido, JANELA_BAIXA)
                const decisao = decidirBaixa({ tipo: 'CREDIT', amount, data: hoje, categoria: nomeAlvo }, pedido, candidatos, JANELA_BAIXA)
                if ('erro' in decisao) return { erro: decisao.erro }
                if (!('usar' in decisao)) return { erro: 'conta a receber já tem lançamento; vínculo não feito' }
                exigirTravadas(travadas, nocionais.map((t) => t.account_id))
                await liquidar()
                await ligar(decisao.usar, candidatos)
                let delta = 0
                // Fix 7 (F7-A, #1): o nocional anterior ao ajuste de caixa da conta fica (o ajuste já o absorveu).
                for (const t of await posAjuste(tx, user.companyId, nocionais)) {
                  await tx.transaction.delete({ where: { id: t.id } })
                  await tx.account.update({
                    where: { id: t.account_id },
                    data: { current_balance: { decrement: t.amount }, updated_at: new Date() },
                  })
                  delta -= t.amount
                }
                return { ligada: true, delta }
              }
              // Já tem o dinheiro (webhook, Receber, antecipação, CNAB, linha ligada): só vira conferida.
              await liquidar()
              // (iv) nocional e há linha do banco livre do mesmo valor: possível duplicidade — avisa (o vínculo é pelo Extrato).
              let aviso: string | undefined
              if (!pedido && linhasDaAR.length === 0) {
                const candidatos = await candidatosLivro(tx, user.companyId, ar.account_id, 'CREDIT', hoje, null, JANELA_CONFERIR)
                if ('usar' in decidirBaixa({ tipo: 'CREDIT', amount, data: hoje, categoria: nomeAlvo }, null, candidatos, JANELA_CONFERIR)) {
                  aviso = 'há linha do banco livre de mesmo valor — vincule pelo Extrato'
                }
              }
              // Idempotente: o vínculo pedido já estava feito para a mesma linha.
              return { ligada: pedidoJaLigado, aviso }
            }

            // (ii) #6 / fix 7 (F7-E, #5): pagamento Asaas a caminho (CONFIRMED, DISPUTED, REFUND_PENDING, AWAITING_*,
            // CHARGEBACK_*…) sem crédito — o dinheiro entra pela linha do extrato: nunca cria dinheiro, só confere e avisa.
            if (!pedido && refs.pagamentos.some((p) => p.provider === 'asaas' && !ASAAS_SEM_DINHEIRO.includes(p.status ?? ''))) {
              await liquidar()
              return { aviso: AVISO_ASAAS_EM_TRANSITO }
            }

            // Sem crédito: decide ligar/criar mesmo que já esteja reconciled (ex.: webhook Inter marcou sem lançar);
            // a trava garante que ninguém mais lança para esta AR enquanto isso.
            // Decide ANTES de escrever: explícito inválido não baixa nada.
            // Sem vínculo explícito, Conferir (ancorado em hoje) olha 30 dias para trás (E3); a linha pedida entra por id.
            const janela = pedido ? JANELA_BAIXA : JANELA_CONFERIR
            const candidatos = await candidatosLivro(tx, user.companyId, ar.account_id, 'CREDIT', hoje, pedido, janela)
            const decisao = decidirBaixa({ tipo: 'CREDIT', amount, data: hoje, categoria: nomeAlvo }, pedido, candidatos, janela)
            if ('erro' in decisao) return { erro: decisao.erro }

            await liquidar()
            if ('usar' in decisao) {
              await ligar(decisao.usar, candidatos)
              return { ligada: true }
            }
            await tx.transaction.create({
              data: {
                company_id: user.companyId,
                account_id: ar.account_id,
                transaction_type: 'CREDIT',
                amount,
                description: `LIQUIDACAO: ${ar.description}`,
                transaction_date: new Date(),
                bank_ref: `AR:${ar.id}`,
                category_id: categoria,
                reconciled: true,
              },
            })
            await tx.account.update({
              where: { id: ar.account_id },
              data: { current_balance: { increment: amount }, updated_at: new Date() },
            })
            return { delta: amount }
          }

          // Fix 10 (F10-A): Desfazer = só desmarcar — LIQUIDADO → RECEBIDO e reconciled=false. Nenhum dinheiro muda: não apaga
          // nocional, não desliga linha, não mexe em saldo (o dinheiro continua da AR; o Conferir seguinte é idempotente).
          await tx.accountReceivable.update({
            where: { id: ar.id, company_id: user.companyId },
            data: { reconciled: false, status: 'RECEBIDO', updated_at: new Date() },
          })
          return {}
        }, { maxWait: 10000, timeout: 20000 })
      } catch (e) {
        // Onda 4 (§8, #16): qualquer falha de uma AR (trava que demorou, deadlock, banco) vai em erros e o lote segue —
        // a resposta {updated, ligadas, erros} sempre volta; a tx desta AR já foi desfeita.
        if (e instanceof ContaAlterada) resultado = { erro: e.message }
        else if (e instanceof LivroJaLigado) resultado = { erro: 'lançamento do livro já ligado por outra baixa' }
        else {
          console.error('[bulk-reconcile] falha na AR', arId, e)
          // Fix 2 (F2-J, m12): também em error_logs (/admin/errors), como o handleError faria com o 500 de antes.
          void logError(e, {
            url: '/api/financeiro/contas-receber/bulk-reconcile', method: 'POST',
            company_id: user.companyId, user_id: user.id, params: { ar: arId, reconciled },
          })
          resultado = { erro: reconciled ? 'erro ao conferir; tente de novo' : 'erro ao desfazer; tente de novo' }
        }
      }
      if (resultado.erro) {
        erros.push({ ar: arId, motivo: resultado.erro })
        continue
      }
      if (resultado.pular) continue
      if (resultado.ligada) ligadas++
      if (resultado.aviso) avisos.push({ ar: arId, motivo: resultado.aviso })
      balanceDelta += resultado.delta ?? 0
      updated++
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: reconciled ? 'bulk_reconcile' : 'bulk_unreconcile',
      entityId: ids.slice(0, 10).join(','), // primeiros 10 IDs no log
      newValue: { count: updated, reconciled, ids_total: ids.length, balance_delta: balanceDelta },
    })

    return success({
      updated,
      requested: ids.length,
      reconciled,
      balance_delta: balanceDelta,
      ligadas,
      erros,
      avisos,
    })
  } catch (err) {
    return handleError(err)
  }
}
