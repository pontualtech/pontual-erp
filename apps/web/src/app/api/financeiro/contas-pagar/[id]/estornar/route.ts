import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import {
  CONFLITO_BANCO, conflitoDeBanco, ContaAlterada, contasComExtrato, contasDaAP, descreverDinheiro, DEVOLVIDO, dinheiroDaAP, exigirTravadas,
  posAjuste, travarContas,
  type LancamentoDaConta,
} from '@/lib/financeiro/livro-baixa-db'

/**
 * POST /api/financeiro/contas-pagar/[id]/estornar
 *
 * C10 fix 22/05: estorno de AP ja paga. Espelho do estorno de AR, travas contas → AP (§7), tudo relido na tx.
 * Fix 10 (F10-B, espelho da AR): com saída lançada (linhas do banco ligadas a AP:<id>, DEBIT AP:<id> vivo) o estorno
 * PERGUNTA — sem resposta, 409 ESTORNO_PERGUNTA: `dinheiro: 'devolvido'` (fix 12/13, F12-B, F13-A) → a linha do banco AP:<id>
 * e o DEBIT AP:<id> anterior ao último AJUSTE de conta com linha do banco ganham :devolvido (a entrada da devolução vem pelo
 * extrato); o DEBIT AP:<id> posterior ao ajuste, ou em conta sem linha do banco, é compensado com CREDIT AP:<id>:estorno;
 * `mover_para: '<id da AP>'` (engano) → a saída passa para a AP certa (AP:<destino>), sem lançamento novo nem saldo. Sem
 * saída: legado (paga antes de 22/05/2026, DEBIT sem bank_ref) → CREDIT pelo paid_amount na conta da AP, só se ela não tem
 * linha do banco (F14-A); senão só status.
 * PENDENTE sem valor pago → 400 'nada a estornar'.
 *
 * Antes, mexer em AP paga só era possível via DELETE (soft delete) que
 * deixava a Transaction DEBIT órfã + saldo deflacionado sem rastro.
 */
type Params = { params: { id: string } }

// A conta tem saída lançada e o operador não disse o que aconteceu com ela.
class PerguntaEstorno extends Error {
  constructor(readonly lancados: LancamentoDaConta[]) {
    super('O dinheiro foi devolvido pelo fornecedor, ou lançado na conta errada?')
  }
}

// Recusa decidida na releitura com as travas: nada gravado.
class RecusaEstorno extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 422) {
    super(message)
  }
}

// AP de taxa descontada no repasse: notes { source: 'acquirer_match' | 'capture-fees' } (perform-match, capture-fees),
// ou 'Desconto automatico' sem notes.source. Quem decide o 409 é a ausência de saída própria (ver o uso).
function taxaDoAdquirente(ap: { payment_method: string | null; notes: string | null }): boolean {
  let source: unknown
  try {
    source = (JSON.parse(ap.notes ?? '') as { source?: unknown } | null)?.source
  } catch {
    source = undefined // notes em texto livre
  }
  if (source === 'acquirer_match' || source === 'capture-fees') return true
  return source === undefined && ap.payment_method === 'Desconto automatico'
}

// Antes de 22/05/2026 (86c9e19b) a baixa criava o lançamento sem bank_ref: 22/05 00:00 em São Paulo.
const LEGADO_ATE = new Date('2026-05-22T03:00:00.000Z')

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
    if (moverPara !== undefined && (typeof moverPara !== 'string' || !moverPara.trim())) return error('mover_para deve ser o id da conta a pagar', 400)
    if (escolha !== undefined && moverPara !== undefined) return error("escolha 'devolvido' ou mover_para, não os dois", 400)

    // Leitura de fora só para saber QUAIS contas travar; quem decide é a releitura dentro da tx.
    const lida = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true, account_id: true },
    })
    if (!lida) return error('Conta a pagar nao encontrada', 404)
    const contas = await contasDaAP(prisma, user.companyId, lida)
    const proprio = `AP:${params.id}`
    const estorno = `AP:${params.id}:estorno`
    const destinoId = typeof moverPara === 'string' ? moverPara.trim() : null
    if (destinoId === params.id) return error('a conta de destino é a própria conta', 422)

    let antes: { status: string | null; paid_amount: number | null }
    try {
      antes = await prisma.$transaction(async (tx) => {
        const travadas = await travarContas(tx, user.companyId, contas)
        // §7: as APs (origem e destino) em ordem de id.
        for (const id of [params.id, ...(destinoId ? [destinoId] : [])].sort()) {
          await tx.$queryRaw`SELECT id FROM accounts_payable WHERE id = ${id} AND company_id = ${user.companyId} FOR UPDATE`
        }
        const ap = await tx.accountPayable.findFirst({
          where: { id: params.id, company_id: user.companyId, deleted_at: null },
        })
        if (!ap) throw new RecusaEstorno('Conta a pagar nao encontrada', 404)
        const paga = ap.status === 'PAGO'
        if (!paga && ap.status !== 'PENDENTE') {
          throw new RecusaEstorno('Apenas APs com status PAGO (ou PENDENTE com pagamento parcial) podem ser estornadas', 400)
        }
        const pago = ap.paid_amount ?? 0
        if (!paga && pago <= 0) throw new RecusaEstorno('nada a estornar', 400)
        // Fix 8 (F8-A, §0): a saída da AP já lançada (linhas do banco ligadas a AP:<id>, DEBIT AP:<id> vivo), líquida
        // dos estornos anteriores.
        const dinheiro = await dinheiroDaAP(tx, user.companyId, ap.id)

        // Onda 4 (fix 2, F2-A; fix 3, F3-C): a taxa que o adquirente/Asaas descontou do repasse (perform-match,
        // capture-fees) nasce PAGA sem DEBIT — a saída já está no crédito líquido; estornar e pagar de novo debitaria a
        // taxa 2x. Só recusa quando a AP não tem saída própria lançada.
        if (taxaDoAdquirente(ap) && dinheiro.total === 0) {
          throw new RecusaEstorno('taxa descontada no repasse do adquirente — não estornável', 409)
        }

        const compensar = new Map<string, number>()
        if (destinoId && dinheiro.total === 0) throw new RecusaEstorno('não há saída lançada nesta conta para mover', 422)
        if (dinheiro.total > 0 && destinoId) {
          // ── mover_para (engano): a saída vai para a AP certa; nada novo, nenhum saldo ──
          const dest = await tx.accountPayable.findFirst({ where: { id: destinoId, company_id: user.companyId, deleted_at: null } })
          if (!dest) throw new RecusaEstorno('Conta a pagar de destino nao encontrada', 404)
          if (dest.status === 'CANCELADO') throw new RecusaEstorno('a conta de destino está cancelada', 422)
          const movido = pago > 0 ? pago : dinheiro.total
          if (movido > dest.total_amount - (dest.paid_amount ?? 0)) throw new RecusaEstorno('valor maior que o saldo em aberto da conta de destino', 422)
          exigirTravadas(travadas, [...dinheiro.linhas, ...dinheiro.nocionais].map((t) => t.account_id))
          const refDestino = `AP:${dest.id}`
          const textos: { id: string; source_text: string | null; category_id: string | null }[] = dinheiro.linhas.length === 0 ? [] : await tx.transaction.findMany({
            where: { company_id: user.companyId, id: { in: dinheiro.linhas.map((l) => l.id) } },
            select: { id: true, source_text: true, category_id: true },
          })
          for (const l of dinheiro.linhas) {
            const texto = textos.find((t) => t.id === l.id)
            await tx.transaction.update({
              where: { id: l.id },
              data: {
                linked_ref: refDestino,
                description: `Pgto: ${dest.description} · banco: ${texto?.source_text ?? ''}`,
                // m4: a linha que levava a categoria da origem passa a levar a do destino.
                ...(dest.category_id && texto?.category_id === ap.category_id ? { category_id: dest.category_id } : {}),
              },
            })
          }
          for (const t of dinheiro.nocionais) {
            await tx.transaction.update({ where: { id: t.id }, data: { bank_ref: refDestino, description: `Pgto: ${dest.description}` } })
          }
          const pagoDestino = (dest.paid_amount ?? 0) + movido
          await tx.accountPayable.update({
            where: { id: dest.id },
            data: { paid_amount: pagoDestino, status: pagoDestino >= dest.total_amount ? 'PAGO' : 'PENDENTE', updated_at: new Date() },
          })
        } else if (dinheiro.total > 0) {
          if (!escolha) throw new PerguntaEstorno(await descreverDinheiro(tx, user.companyId, dinheiro))
          // ── 'devolvido' (fix 12, F12-B): a linha do banco (e o marcador antigo LIGADA:) ganha :devolvido, nada lançado — a
          // entrada da devolução chega pelo extrato; o DEBIT AP:<id> não convertido é compensado com CREDIT AP:<id>:estorno na
          // conta dele, sem renomear (o banco nunca confirmou essa saída) — salvo o anterior ao ajuste (F13-A, abaixo) ──
          // Fix 13 (F13-A): o DEBIT AP:<id> ANTERIOR ao último AJUSTE de conta com linha do banco já foi absorvido pelo ajuste
          // (saída confirmada) → como a linha, só o sufixo :devolvido, sem lançamento.
          const ligadaAntiga = (t: { source_text: string | null }) => (t.source_text ?? '').startsWith('LIGADA:')
          const debitos = dinheiro.nocionais.filter((n) => !ligadaAntiga(n))
          const comExtrato = await contasComExtrato(tx, user.companyId, debitos.map((t) => t.account_id))
          const posteriores = new Set((await posAjuste(tx, user.companyId, debitos)).map((t) => t.id))
          const absorvidos = debitos.filter((t) => comExtrato.has(t.account_id) && !posteriores.has(t.id))
          for (const t of debitos.filter((n) => !absorvidos.includes(n))) {
            compensar.set(t.account_id, (compensar.get(t.account_id) ?? 0) + (t.vivo ?? t.amount))
          }
          const sufixar: { id: string; account_id: string; origin: string | null }[] = await tx.transaction.findMany({
            where: {
              company_id: user.companyId,
              OR: [
                { origin: 'BANCO', linked_ref: proprio },
                { origin: null, bank_ref: proprio, source_text: { startsWith: 'LIGADA:' } },
                ...(absorvidos.length > 0 ? [{ id: { in: absorvidos.map((t) => t.id) } }] : []),
              ],
            },
            select: { id: true, account_id: true, origin: true },
          })
          exigirTravadas(travadas, [...sufixar.map((t) => t.account_id), ...compensar.keys()])
          for (const t of sufixar) {
            await tx.transaction.update({
              where: { id: t.id },
              data: t.origin === 'BANCO' ? { linked_ref: `${proprio}${DEVOLVIDO}` } : { bank_ref: `${proprio}${DEVOLVIDO}` },
            })
          }
        } else {
          // (c) legado: paga antes de 22/05 com conta e valor, sem nenhum lançamento próprio nem linha ligada. Fix 3/4
          // (F3-A, F4-A): conta criada antes de 22/05; updated_at antigo OU a transação legada DESTA AP — DEBIT do ERP sem
          // bank_ref, do valor pago, na conta da AP, antes de 22/05, com a descrição exata 'Pgto: ' + descrição.
          const proprios = await tx.transaction.count({
            where: { company_id: user.companyId, OR: [{ bank_ref: { in: [proprio, estorno] } }, { linked_ref: proprio }] },
          })
          const candidataLegado = paga && !!ap.account_id && pago > 0 && proprios === 0
          const legado = candidataLegado
            && !!ap.created_at && ap.created_at.getTime() < LEGADO_ATE.getTime()
            && (
              (!!ap.updated_at && ap.updated_at.getTime() < LEGADO_ATE.getTime())
              || (await tx.transaction.count({
                where: {
                  company_id: user.companyId, account_id: ap.account_id!, transaction_type: 'DEBIT', amount: pago,
                  bank_ref: null, origin: null, created_at: { lt: LEGADO_ATE }, description: `Pgto: ${ap.description}`,
                },
              })) > 0
            )
          // Fix 14 (F14-A): conta com linha do banco → o pagamento legado é anterior ao ajuste (absorvido) e a entrada da
          // devolução chega pelo extrato: não compensa (só status/valores). Conta sem linha do banco → compensa como sempre.
          if (legado && !(await contasComExtrato(tx, user.companyId, [ap.account_id!])).has(ap.account_id!)) compensar.set(ap.account_id!, pago)
          // Quitada sem valor, sem dinheiro e sem legado: nada a estornar.
          if (!legado && pago <= 0) throw new RecusaEstorno('nada a estornar', 400)
          exigirTravadas(travadas, [...compensar.keys()])
        }

        for (const [contaId, valor] of compensar) {
          // CREDIT compensatório (reverte o DEBIT original): bank_ref "AP:{id}:estorno" distingue do DEBIT.
          await tx.transaction.create({
            data: {
              company_id: user.companyId,
              account_id: contaId,
              transaction_type: 'CREDIT',
              amount: valor,
              description: `Estorno: ${ap.description}${motivo ? ` (${motivo})` : ''}`,
              transaction_date: new Date(),
              bank_ref: estorno,
              reconciled: true,
            },
          })
          await tx.account.update({
            where: { id: contaId },
            data: { current_balance: { increment: valor }, updated_at: new Date() },
          })
        }

        await tx.accountPayable.update({
          where: { id: ap.id },
          data: { status: 'PENDENTE', paid_amount: 0, reconciled: false, updated_at: new Date() },
        })
        return { status: ap.status, paid_amount: ap.paid_amount }
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
      action: 'payable.estorno',
      entityId: params.id,
      oldValue: antes,
      newValue: { status: 'PENDENTE', paid_amount: 0, motivo, ...(destinoId ? { movido_para: destinoId } : { dinheiro: escolha ?? null }) },
    })

    return success({ ok: true, payable_id: params.id, ...(destinoId ? { movido_para: destinoId } : {}) })
  } catch (err) {
    return handleError(err)
  }
}
