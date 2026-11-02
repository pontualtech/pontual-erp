import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { refsCreditoAdquirente } from '@/lib/acquirer/match-rules'
import { decidirBaixa, JANELA_BAIXA, JANELA_CONFERIR, recebeCategoria } from '@/lib/financeiro/livro-baixa'
import { candidatosLivro, desligarLinhas, hojeSP, nomeCategoria, SELECT_LINHA_LIGADA } from '@/lib/financeiro/livro-baixa-db'
import { compensado } from '@/lib/financeiro/livro'
import { categoriaReceitaPadraoId } from '@/lib/financeiro/categoria-receita-padrao'
import { CATEGORIA_RECEITA_SERVICOS } from '@/lib/financeiro/livro-categorias'

// Lançamento do livro foi ligado por outra baixa concorrente → desfaz a $transaction desta AR.
class LivroJaLigado extends Error {}

// Resultado de cada AR: erro (vai em erros), pular (sem valor; não conta), ligada / delta de saldo.
type ResultadoAR = { erro?: string; pular?: boolean; ligada?: boolean; delta?: number }

// Vínculo explícito AR → lançamento do livro (rotina): { [arId]: transactionId }.
const livroSchema = z.record(z.string()).optional()

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
 * - reconciled=false → desfaz: status volta pra RECEBIDO + reverte Transaction + balance--
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

    const body = await req.json().catch(() => ({}))
    const { ids, reconciled } = body as { ids?: string[]; reconciled?: boolean }
    const livro = livroSchema.parse((body as { livro?: unknown }).livro)

    if (!Array.isArray(ids) || ids.length === 0) {
      return error('ids é obrigatório (array não vazio)', 400)
    }
    if (typeof reconciled !== 'boolean') {
      return error('reconciled é obrigatório (boolean true/false)', 400)
    }
    if (ids.length > 200) {
      return error('Máximo 200 itens por operação', 400)
    }

    // Daqui só saem os ids: tudo o que decide (status, valor, conta, lançamento existente) é relido
    // DENTRO da $transaction de cada AR, depois de travar a linha (E1).
    const arsToProcess = await prisma.accountReceivable.findMany({
      where: { id: { in: ids }, company_id: user.companyId, deleted_at: null },
      select: { id: true },
    })

    let updated = 0
    let ligadas = 0
    const erros: { ar: string; motivo: string }[] = []
    let balanceDelta = 0  // pra retornar ao frontend confirmando o impacto

    // Loop por AR — cada uma com seu próprio account_id e amount.
    // $transaction atomic dentro do loop garante AR + Transaction + balance
    // são sempre consistentes pra cada AR individualmente.
    for (const { id: arId } of arsToProcess) {
      // Vínculo explícito pedido (só na conferência): se não puder ser feito, NÃO liquida — vai em erros (F11).
      const pedido = reconciled ? livro?.[arId] ?? null : null

      let resultado: ResultadoAR
      try {
        resultado = await prisma.$transaction(async (tx): Promise<ResultadoAR> => {
          // E1: trava a linha da AR — Receber, Desfazer, webhook e outro Conferir atualizam esta mesma linha,
          // então esperam aqui; a releitura abaixo já enxerga o que eles comitaram.
          await tx.$queryRaw`SELECT id FROM accounts_receivable WHERE id = ${arId} AND company_id = ${user.companyId} FOR UPDATE`
          const ar = await tx.accountReceivable.findFirst({
            where: { id: arId, company_id: user.companyId, deleted_at: null },
            select: { id: true, account_id: true, received_amount: true, total_amount: true, status: true, description: true, category_id: true, reconciled: true },
          })
          if (!ar) return { erro: 'conta a receber não encontrada' }
          // Onda 4 (§4): Desfazer só desfaz conta conferida — AR estornada/PENDENTE (#8) não perde crédito nem saldo.
          if (!reconciled && ar.reconciled !== true && ar.status !== 'LIQUIDADO') return { erro: 'conta não conferida' }
          // Conferir exige conta recebida (PAGO = status legado de recebida): PENDENTE não vira LIQUIDADO nem ganha crédito.
          if (reconciled && ar.status !== 'RECEBIDO' && ar.status !== 'LIQUIDADO' && ar.status !== 'PAGO') return { erro: 'conta não recebida' }

          const amount = ar.received_amount || ar.total_amount
          if (!amount) return pedido ? { erro: 'conta a receber sem valor; vínculo não feito' } : { pular: true }

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
            // RECEBIDO → LIQUIDADO: cria Transaction + incrementa saldo.
            // Idempotência: se já tem Transaction com bank_ref=AR:id, pula save.
            // 29/10: idem se a maquininha já creditou o LÍQUIDO desta AR (acquirer:<provider>:<NSU>) —
            // senão o "Conferi" somava o BRUTO por cima e o dinheiro contava 2x.
            const pagamentos = await tx.payment.findMany({
              where: { company_id: user.companyId, receivable_id: ar.id },
              select: { provider: true, external_id: true },
            })
            const existing = await tx.transaction.findFirst({
              where: { company_id: user.companyId, OR: [{ bank_ref: { in: [`AR:${ar.id}`, ...refsCreditoAdquirente(pagamentos)] } }, { linked_ref: `AR:${ar.id}` }] },
            })
            if (existing && pedido && existing.id !== pedido) {
              // Vínculo explícito pedido, mas a AR já tem outro lançamento: não troca nem baixa em silêncio.
              return { erro: 'conta a receber já tem lançamento; vínculo não feito' }
            }
            if (existing) {
              // Já tem crédito (ex: webhook Asaas, Receber, backfill manual): só vira conferida — nada criado nem ligado.
              await tx.accountReceivable.update({
                where: { id: ar.id, company_id: user.companyId },
                data: { reconciled: true, status: 'LIQUIDADO', updated_at: new Date() },
              })
              // Idempotente: o vínculo pedido já estava feito para a mesma linha.
              return { ligada: !!pedido }
            }

            // Sem crédito: decide ligar/criar mesmo que já esteja reconciled (ex.: webhook Inter marcou sem lançar);
            // a trava garante que ninguém mais lança para esta AR enquanto isso.
            const categoria = ar.category_id
              ?? await categoriaReceitaPadraoId(tx, user.companyId)
            const nomeAlvo = ar.category_id ? await nomeCategoria(tx, user.companyId, ar.category_id) : CATEGORIA_RECEITA_SERVICOS

            // Decide ANTES de escrever: explícito inválido não baixa nada.
            // Sem vínculo explícito, Conferir (ancorado em hoje) olha 30 dias para trás (E3); a linha pedida entra por id.
            const janela = pedido ? JANELA_BAIXA : JANELA_CONFERIR
            // Uma data só por AR: busca e decisão no mesmo dia mesmo se a meia-noite virar no meio.
            const hoje = hojeSP()
            const candidatos = await candidatosLivro(tx, user.companyId, ar.account_id, 'CREDIT', hoje, pedido, janela)
            const decisao = decidirBaixa({ tipo: 'CREDIT', amount, data: hoje, categoria: nomeAlvo }, pedido, candidatos, janela)
            if ('erro' in decisao) return { erro: decisao.erro }

            await tx.accountReceivable.update({
              where: { id: ar.id, company_id: user.companyId },
              data: { reconciled: true, status: 'LIQUIDADO', updated_at: new Date() },
            })
            if ('usar' in decisao) {
              // Liga ao lançamento do livro: o dinheiro já está no saldo — NÃO cria transação nem mexe na conta.
              const alvo = await tx.transaction.findFirst({
                where: { id: decisao.usar, company_id: user.companyId },
                select: { source_text: true },
              })
              // Linha já categorizada (ex.: Venda de Servicos) mantém a sua categoria.
              const linha = candidatos.find((c) => c.id === decisao.usar)
              // Guard atômico (como Bug #41/#67): só liga se a linha ainda estiver livre.
              const ligou = await tx.transaction.updateMany({
                where: { id: decisao.usar, company_id: user.companyId, linked_ref: null },
                data: {
                  linked_ref: `AR:${ar.id}`,
                  ...(recebeCategoria(linha?.categoria ?? null) ? { category_id: categoria } : {}),
                  description: `LIQUIDACAO: ${ar.description} · banco: ${alvo?.source_text ?? ''}`,
                  reconciled: true,
                },
              })
              if (ligou.count === 0) throw new LivroJaLigado()
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

          // LIQUIDADO → RECEBIDO (onda 4 §4), relido com a AR travada: as linhas do banco ligadas à AR são DESLIGADAS
          // (sem apagar nem mexer no saldo) e TODOS os créditos nocionais AR:id ainda vivos são apagados com o saldo;
          // o já compensado por um :estorno fica (o par se anula). Crédito com o marcador antigo LIGADA: é dinheiro do banco.
          const ligadas = await tx.transaction.findMany({
            where: { company_id: user.companyId, origin: 'BANCO', linked_ref: `AR:${ar.id}` },
            select: SELECT_LINHA_LIGADA,
          })
          const creditos = await tx.transaction.findMany({
            where: { company_id: user.companyId, bank_ref: `AR:${ar.id}`, transaction_type: 'CREDIT', origin: null, source_text: null },
            select: { id: true, amount: true, account_id: true, created_at: true },
          })
          const estornos = await tx.transaction.findMany({
            where: { company_id: user.companyId, bank_ref: `AR:${ar.id}:estorno` },
            select: { account_id: true, created_at: true },
          })
          const vivos = creditos.filter((c) => !compensado(c, estornos))
          await tx.accountReceivable.update({
            where: { id: ar.id, company_id: user.companyId },
            data: { reconciled: false, status: 'RECEBIDO', updated_at: new Date() },
          })
          await desligarLinhas(tx, user.companyId, ligadas)
          let delta = 0
          for (const c of vivos) {
            await tx.transaction.delete({ where: { id: c.id } })
            await tx.account.update({
              where: { id: c.account_id },
              data: { current_balance: { decrement: c.amount }, updated_at: new Date() },
            })
            delta -= c.amount
          }
          return { delta }
        })
      } catch (e) {
        if (!(e instanceof LivroJaLigado)) throw e
        resultado = { erro: 'lançamento do livro já ligado por outra baixa' }
      }
      if (resultado.erro) {
        erros.push({ ar: arId, motivo: resultado.erro })
        continue
      }
      if (resultado.pular) continue
      if (resultado.ligada) ligadas++
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
    })
  } catch (err) {
    return handleError(err)
  }
}
