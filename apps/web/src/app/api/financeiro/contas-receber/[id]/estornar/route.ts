import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { refsCreditoAdquirente } from '@/lib/acquirer/match-rules'
import {
  CONFLITO_BANCO, conflitoDeBanco, ContaAlterada, contasComExtrato, contasDaAR, descreverDinheiro, DEVOLVIDO, dinheiroDaAR,
  exigirTravadas, refsDaAR, travarContas, type DinheiroLancado, type LancamentoDaConta,
} from '@/lib/financeiro/livro-baixa-db'

/**
 * POST /api/financeiro/contas-receber/[id]/estornar
 *
 * C10 fix 22/05: estorno de AR ja recebida. Ordem de travas do §7 (contas → AR) e tudo relido dentro da tx.
 * Fix 10 (F10-B, decisão do Karlão 02/11: estorno é raro e quase sempre devolução real). Com dinheiro na conta (linhas do
 * banco ligadas a qualquer ref dela, nocionais próprios vivos, créditos do adquirente/Asaas/CNAB) o estorno PERGUNTA — sem
 * resposta no corpo, 409 ESTORNO_PERGUNTA:
 *   `dinheiro: 'devolvido'` (fix 12, F12-B) → a linha do banco própria (confirmada pelo extrato) ganha o sufixo
 *       :devolvido, sem lançamento (a saída da devolução chega pelo extrato); o nocional próprio não convertido, em
 *       qualquer conta, é compensado com DEBIT AR:<id>:estorno na conta dele; o externo que não é pay_ em conta sem linha
 *       do banco (cnab: na Inter) também; pay_ e externo em conta com extrato não são tocados e voltam em `aviso`.
 *   `mover_para: '<id da AR | nº da OS>'` (engano) → move o dinheiro vivo para a conta certa: linhas e nocionais AR:<id>
 *       → AR:<destino>, Payments dos créditos externos → receivable_id/service_order_id do destino. Nenhum lançamento novo,
 *       nenhum saldo; o destino soma o valor recebido (RECEBIDO se cheio). Antecipação e CNAB não são movíveis (422).
 * Sem dinheiro: legado (recebida antes de 22/05/2026, lançamento sem bank_ref) → DEBIT pelo received_amount na conta da
 * AR; senão só status/valores. PENDENTE sem valor recebido → 400 'nada a estornar'.
 */
type Params = { params: { id: string } }

const PERGUNTA = 'O dinheiro foi devolvido ao cliente, ou foi lançado na OS errada?'
const QUITADAS = ['RECEBIDO', 'LIQUIDADO', 'PAGO']

// A conta tem dinheiro e o operador não disse o que aconteceu com ele.
class PerguntaEstorno extends Error {
  constructor(readonly lancados: LancamentoDaConta[]) {
    super(PERGUNTA)
  }
}

// Recusa decidida na releitura com as travas: nada gravado.
class RecusaEstorno extends Error {
  constructor(message: string, readonly status: 400 | 404 | 422) {
    super(message)
  }
}

// Antes de 22/05/2026 (86c9e19b) a baixa criava o lançamento sem bank_ref: 22/05 00:00 em São Paulo.
const LEGADO_ATE = new Date('2026-05-22T03:00:00.000Z')

// Fix 10 (F10-B): o destino do mover_para — o id da AR ou o número da OS (a única AR em aberto dela). Fix 12 (F12-D): a
// original de um agrupamento (AGRUPADO / grouped_into_id) não é aberta — a cobrada é a agrupadora; nº de OS só com até
// 9 dígitos (o os_number é INT4: acima disso o Prisma daria 500).
async function resolverDestino(db: any, companyId: string, alvo: string): Promise<string | null> {
  const porId = await db.accountReceivable.findFirst({ where: { id: alvo, company_id: companyId, deleted_at: null }, select: { id: true } })
  if (porId) return porId.id
  if (!/^\d{1,9}$/.test(alvo)) throw new RecusaEstorno('mover_para deve ser o id da conta a receber ou o número da OS', 422)
  const os = await db.serviceOrder.findFirst({ where: { company_id: companyId, os_number: Number(alvo) }, select: { id: true } })
  if (!os) return null
  const abertas: { id: string }[] = await db.accountReceivable.findMany({
    where: { company_id: companyId, service_order_id: os.id, deleted_at: null, grouped_into_id: null, status: { notIn: ['CANCELADO', 'AGRUPADO', ...QUITADAS] } },
    select: { id: true },
  })
  if (abertas.length !== 1) {
    throw new RecusaEstorno(abertas.length === 0 ? `OS ${alvo} sem conta a receber em aberto` : `OS ${alvo} tem ${abertas.length} contas a receber em aberto — informe a conta`, 422)
  }
  return abertas[0].id
}

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const motivo = (body as any)?.motivo ? String((body as any).motivo).trim().slice(0, 500) : null
    const escolha = (body as any)?.dinheiro as unknown
    const moverPara = (body as any)?.mover_para as unknown
    if (escolha !== undefined && escolha !== 'devolvido') return error("dinheiro deve ser 'devolvido' (engano: use mover_para)", 400)
    if (moverPara !== undefined && (typeof moverPara !== 'string' || !moverPara.trim())) {
      return error('mover_para deve ser o id da conta a receber ou o número da OS', 400)
    }
    if (escolha !== undefined && moverPara !== undefined) return error("escolha 'devolvido' ou mover_para, não os dois", 400)

    // Leitura de fora só para saber QUAIS contas e ARs travar; quem decide é a releitura dentro da tx.
    const lida = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true, account_id: true, pix_code: true },
    })
    if (!lida) return error('Conta a receber nao encontrada', 404)
    const contas = await contasDaAR(prisma, user.companyId, lida)
    let destinoId: string | null = null
    if (typeof moverPara === 'string') {
      try {
        destinoId = await resolverDestino(prisma, user.companyId, moverPara.trim())
      } catch (e) {
        if (e instanceof RecusaEstorno) return error(e.message, e.status)
        throw e
      }
      if (!destinoId) return error('Conta a receber de destino nao encontrada', 404)
      if (destinoId === params.id) return error('a conta de destino é a própria conta', 422)
    }

    let antes: { status: string | null; received_amount: number | null }
    let aviso: string | undefined
    try {
      antes = await prisma.$transaction(async (tx) => {
        const travadas = await travarContas(tx, user.companyId, contas)
        // §7: as ARs (origem e destino) em ordem de id.
        for (const id of [params.id, ...(destinoId ? [destinoId] : [])].sort()) {
          await tx.$queryRaw`SELECT id FROM accounts_receivable WHERE id = ${id} AND company_id = ${user.companyId} FOR UPDATE`
        }
        const ar = await tx.accountReceivable.findFirst({
          where: { id: params.id, company_id: user.companyId, deleted_at: null },
        })
        if (!ar) throw new RecusaEstorno('Conta a receber nao encontrada', 404)
        const quitada = QUITADAS.includes(ar.status ?? '')
        if (!quitada && ar.status !== 'PENDENTE') {
          throw new RecusaEstorno('Apenas ARs com status RECEBIDO/LIQUIDADO (ou PENDENTE com recebimento parcial) podem ser estornadas', 400)
        }

        const refs = await refsDaAR(tx, user.companyId, ar)
        const recebido = ar.received_amount ?? 0
        // Já estornada (ou nunca recebida): PENDENTE sem valor recebido.
        if (!quitada && recebido <= 0) throw new RecusaEstorno('nada a estornar', 400)

        const dinheiro = await dinheiroDaAR(tx, user.companyId, ar)
        const propria = (ref: string | null | undefined) => ref === refs.proprio || ref === refs.antecipacao
        const compensar = new Map<string, number>()
        if (destinoId && dinheiro.total === 0) throw new RecusaEstorno('não há dinheiro lançado nesta conta para mover', 422)

        if (dinheiro.total > 0 && destinoId) {
          // ── mover_para (engano): o dinheiro vivo vai para a conta certa; nada novo, nenhum saldo ──
          const dest = await tx.accountReceivable.findFirst({ where: { id: destinoId, company_id: user.companyId, deleted_at: null } })
          if (!dest) throw new RecusaEstorno('Conta a receber de destino nao encontrada', 404)
          if (dest.status === 'CANCELADO') throw new RecusaEstorno('a conta de destino está cancelada', 422)
          if (dest.status === 'AGRUPADO' || dest.grouped_into_id) throw new RecusaEstorno('conta agrupada — escolha a agrupadora', 422)
          const refsDoDinheiro = [...dinheiro.linhas.map((l) => l.linked_ref ?? null), ...dinheiro.nocionais.map((t) => t.bank_ref)]
          if (refsDoDinheiro.some((r) => r === refs.antecipacao || (r ?? '').startsWith('cnab:'))) {
            throw new RecusaEstorno('antecipação ou boleto CNAB não pode ser movido para outra conta — estorne como devolvido', 422)
          }
          const movido = recebido > 0 ? recebido : dinheiro.total
          if (movido > dest.total_amount - (dest.received_amount ?? 0)) {
            throw new RecusaEstorno('valor maior que o saldo em aberto da conta de destino', 422)
          }
          const linhas = dinheiro.linhas.filter((l) => propria(l.linked_ref))
          const nocionais = dinheiro.nocionais.filter((t) => propria(t.bank_ref))
          const pagamentos: { id: string; provider: string | null; external_id: string | null; service_order_id: string | null }[] =
            await tx.payment.findMany({
              where: { company_id: user.companyId, receivable_id: ar.id },
              select: { id: true, provider: true, external_id: true, service_order_id: true },
            })
          const pagamentosDoDinheiro = pagamentos.filter((p) => refsCreditoAdquirente([p]).some((r) => refsDoDinheiro.includes(r)))
          exigirTravadas(travadas, [...linhas, ...nocionais].map((t) => t.account_id))

          const refDestino = `AR:${dest.id}`
          const textos: { id: string; source_text: string | null; category_id: string | null }[] = linhas.length === 0 ? [] : await tx.transaction.findMany({
            where: { company_id: user.companyId, id: { in: linhas.map((l) => l.id) } },
            select: { id: true, source_text: true, category_id: true },
          })
          for (const l of linhas) {
            const texto = textos.find((t) => t.id === l.id)
            await tx.transaction.update({
              where: { id: l.id },
              data: {
                linked_ref: refDestino,
                description: `Recebimento: ${dest.description} · banco: ${texto?.source_text ?? ''}`,
                // m4: a linha que levava a categoria da origem passa a levar a do destino.
                ...(dest.category_id && texto?.category_id === ar.category_id ? { category_id: dest.category_id } : {}),
              },
            })
          }
          for (const t of nocionais) {
            await tx.transaction.update({ where: { id: t.id }, data: { bank_ref: refDestino, description: `Recebimento: ${dest.description}` } })
          }
          for (const p of pagamentosDoDinheiro) {
            await tx.payment.update({
              where: { id: p.id },
              data: { receivable_id: dest.id, ...(p.service_order_id ? { service_order_id: dest.service_order_id } : {}) },
            })
          }
          const recebidoDestino = (dest.received_amount ?? 0) + movido
          await tx.accountReceivable.update({
            where: { id: dest.id },
            data: { received_amount: recebidoDestino, status: recebidoDestino >= dest.total_amount ? 'RECEBIDO' : 'PENDENTE', updated_at: new Date() },
          })
        } else if (dinheiro.total > 0) {
          if (!escolha) throw new PerguntaEstorno(await descreverDinheiro(tx, user.companyId, dinheiro))
          // ── 'devolvido' (fix 12, F12-B): o que o banco confirmou espera o extrato; o resto compensa ──
          // · linha BANCO própria (e o marcador antigo LIGADA: — dinheiro já confirmado) → sufixo :devolvido, nada lançado
          //   (a saída da devolução chega pela linha do banco);
          // · nocional próprio não convertido, em QUALQUER conta → DEBIT AR:<id>:estorno na conta dele, sem renomear (o banco
          //   nunca o confirmou: Receber na conta errada, comprovante falso, devolução no Caixa);
          // · externo que não é pay_ em conta SEM extrato (cnab: na Inter, acquirer: fora do livro) → idem; pay_ e externo em
          //   conta COM extrato → só aviso (o webhook REFUNDED / o repasse da Rede trazem a devolução).
          const ligadaAntiga = (t: { source_text: string | null }) => (t.source_text ?? '').startsWith('LIGADA:')
          const externosNoc = dinheiro.nocionais.filter((t) => !propria(t.bank_ref))
          const comExtrato = await contasComExtrato(tx, user.companyId, externosNoc.map((t) => t.account_id))
          const compensa = (t: (typeof dinheiro.nocionais)[number]) => propria(t.bank_ref)
            ? !ligadaAntiga(t)
            : !(t.bank_ref ?? '').startsWith('pay_') && !comExtrato.has(t.account_id)
          for (const t of dinheiro.nocionais.filter(compensa)) {
            compensar.set(t.account_id, (compensar.get(t.account_id) ?? 0) + (t.vivo ?? t.amount))
          }
          const avisar: DinheiroLancado = {
            linhas: dinheiro.linhas.filter((l) => !propria(l.linked_ref)), nocionais: externosNoc.filter((t) => !compensa(t)), total: 0, conta: null,
          }
          if (avisar.linhas.length + avisar.nocionais.length > 0) {
            const lista = (await descreverDinheiro(tx, user.companyId, avisar)).map((l) => `${l.origem} ${brl(l.valor_centavos)}`).join('; ')
            aviso = `dinheiro externo não foi tocado — a devolução passa pelo próprio canal (Asaas/maquininha/boleto): ${lista}`
          }
          const sufixar: { id: string; account_id: string; origin: string | null; bank_ref: string | null; linked_ref: string | null }[] =
            await tx.transaction.findMany({
              where: {
                company_id: user.companyId,
                OR: [
                  { origin: 'BANCO', linked_ref: { in: [refs.proprio, refs.antecipacao] } },
                  { origin: null, bank_ref: { in: [refs.proprio, refs.antecipacao] }, source_text: { startsWith: 'LIGADA:' } },
                ],
              },
              select: { id: true, account_id: true, origin: true, bank_ref: true, linked_ref: true },
            })
          exigirTravadas(travadas, [...sufixar.map((t) => t.account_id), ...compensar.keys()])
          for (const t of sufixar) {
            await tx.transaction.update({
              where: { id: t.id },
              data: t.origin === 'BANCO' ? { linked_ref: `${t.linked_ref}${DEVOLVIDO}` } : { bank_ref: `${t.bank_ref}${DEVOLVIDO}` },
            })
          }
        } else {
          // (c) legado: quitada antes de 22/05 com conta e valor, sem nenhum lançamento próprio nem linha ligada.
          // Fix 3/4 (F3-A, F4-A): (ii) sem dinheiro externo (garantido aqui: dinheiro.total = 0); (iii) conta criada antes de
          // 22/05; sem pagamento por fora (Asaas CONFIRMED/RECEIVED, adquirente); (iv) updated_at antigo OU a transação
          // legada DESTA AR — CREDIT do ERP sem bank_ref, do valor recebido, na conta da AR, antes de 22/05, com a
          // descrição exata da baixa antiga ('Recebimento: ' + descrição).
          const proprios = await tx.transaction.count({
            where: { company_id: user.companyId, OR: [{ bank_ref: { in: [refs.proprio, refs.antecipacao, refs.estorno] } }, { linked_ref: refs.proprio }] },
          })
          const candidataLegado = quitada && !!ar.account_id && recebido > 0 && proprios === 0
          const pagaPorFora = refs.pagamentos.some((p) =>
            (p.provider === 'asaas' && (p.status === 'CONFIRMED' || p.status === 'RECEIVED')) || p.provider === 'rede')
          const legado = candidataLegado && !pagaPorFora
            && !!ar.created_at && ar.created_at.getTime() < LEGADO_ATE.getTime()
            && (
              (!!ar.updated_at && ar.updated_at.getTime() < LEGADO_ATE.getTime())
              || (await tx.transaction.count({
                where: {
                  company_id: user.companyId, account_id: ar.account_id!, transaction_type: 'CREDIT', amount: recebido,
                  bank_ref: null, origin: null, created_at: { lt: LEGADO_ATE }, description: `Recebimento: ${ar.description}`,
                },
              })) > 0
            )
          if (legado) compensar.set(ar.account_id!, recebido)
          // Quitada sem valor, sem dinheiro e sem legado: nada a estornar.
          if (!legado && recebido <= 0) throw new RecusaEstorno('nada a estornar', 400)
          exigirTravadas(travadas, [...compensar.keys()])
        }

        for (const [contaId, valor] of compensar) {
          await tx.transaction.create({
            data: {
              company_id: user.companyId,
              account_id: contaId,
              transaction_type: 'DEBIT',
              amount: valor,
              description: `Estorno: ${ar.description}${motivo ? ` (${motivo})` : ''}`,
              transaction_date: new Date(),
              bank_ref: refs.estorno,
              reconciled: true,
            },
          })
          await tx.account.update({
            where: { id: contaId },
            data: { current_balance: { decrement: valor }, updated_at: new Date() },
          })
        }

        await tx.accountReceivable.update({
          where: { id: ar.id },
          data: { status: 'PENDENTE', received_amount: 0, reconciled: false, anticipated_at: null, updated_at: new Date() },
        })
        return { status: ar.status, received_amount: ar.received_amount }
      }, { maxWait: 10000, timeout: 20000 })
    } catch (e) {
      if (e instanceof RecusaEstorno) return error(e.message, e.status)
      if (e instanceof PerguntaEstorno) {
        return NextResponse.json({ code: 'ESTORNO_PERGUNTA', error: e.message, lancados: e.lancados }, { status: 409 })
      }
      if (e instanceof ContaAlterada) return error(e.message, 409)
      if (conflitoDeBanco(e)) return error(CONFLITO_BANCO, 409)
      throw e
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.estorno',
      entityId: params.id,
      oldValue: antes,
      newValue: { status: 'PENDENTE', received_amount: 0, motivo, ...(destinoId ? { movido_para: destinoId } : { dinheiro: escolha ?? null }) },
    })

    return success({ ok: true, receivable_id: params.id, ...(destinoId ? { movido_para: destinoId } : {}), ...(aviso ? { aviso } : {}) })
  } catch (err) {
    return handleError(err)
  }
}
