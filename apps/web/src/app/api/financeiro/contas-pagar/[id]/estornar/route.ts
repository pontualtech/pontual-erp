import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { CONFLITO_BANCO, conflitoDeBanco, ContaAlterada, contasDaAP, desligarLinhas, dinheiroDaAP, exigirTravadas, SELECT_LINHA_LIGADA, travarContas } from '@/lib/financeiro/livro-baixa-db'

/**
 * POST /api/financeiro/contas-pagar/[id]/estornar
 *
 * C10 fix 22/05: estorno de AP ja paga. Onda 4 (§3, espelho do estorno de AR), travas contas → AP (§7), tudo relido na tx:
 *   (a) linhas do BANCO ligadas à AP (AP:<id>: baixa ou DEBIT convertido pelo livro) → DESLIGA, sem saldo;
 *   (b) DEBIT AP:<id> ainda nocional → CREDIT AP:<id>:estorno pelo líquido (próprios − estornos) na conta de cada um;
 *   (c) legado (paga antes de 22/05/2026, DEBIT sem bank_ref) → CREDIT pelo paid_amount na conta da AP;
 *   (d) nada disso → só status/valores. Já estornada (nada em a/b/c e sem valor pago) → 400 'nada a estornar'.
 *
 * Antes, mexer em AP paga só era possível via DELETE (soft delete) que
 * deixava a Transaction DEBIT órfã + saldo deflacionado sem rastro.
 */
type Params = { params: { id: string } }

// Recusa decidida na releitura com as travas: nada gravado.
class RecusaEstorno extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
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

    // Leitura de fora só para saber QUAIS contas travar; quem decide é a releitura dentro da tx.
    const lida = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true, account_id: true },
    })
    if (!lida) return error('Conta a pagar nao encontrada', 404)
    const contas = await contasDaAP(prisma, user.companyId, lida)
    const proprio = `AP:${params.id}`
    const estorno = `AP:${params.id}:estorno`

    let antes: { status: string | null; paid_amount: number | null }
    try {
      antes = await prisma.$transaction(async (tx) => {
        const travadas = await travarContas(tx, user.companyId, contas)
        await tx.$queryRaw`SELECT id FROM accounts_payable WHERE id = ${params.id} AND company_id = ${user.companyId} FOR UPDATE`
        const ap = await tx.accountPayable.findFirst({
          where: { id: params.id, company_id: user.companyId, deleted_at: null },
        })
        if (!ap) throw new RecusaEstorno('Conta a pagar nao encontrada', 404)
        const paga = ap.status === 'PAGO'
        if (!paga && ap.status !== 'PENDENTE') {
          throw new RecusaEstorno('Apenas APs com status PAGO (ou PENDENTE com pagamento parcial) podem ser estornadas', 400)
        }
        // (a) linhas do banco que hoje representam a saída desta AP.
        const ligadas = await tx.transaction.findMany({
          where: { company_id: user.companyId, origin: 'BANCO', linked_ref: proprio },
          select: SELECT_LINHA_LIGADA,
        })
        // (b) lançamentos próprios por bank_ref; nocional = ainda não convertido.
        const daAP = await tx.transaction.findMany({
          where: { company_id: user.companyId, bank_ref: { in: [proprio, estorno] } },
          select: { amount: true, transaction_type: true, bank_ref: true, account_id: true, origin: true, source_text: true },
        })
        const compensar = new Map<string, number>()
        for (const t of daAP) {
          if (t.origin !== null || t.source_text !== null) continue
          const sinal = t.bank_ref === proprio && t.transaction_type === 'DEBIT' ? 1
            : t.bank_ref === estorno && t.transaction_type === 'CREDIT' ? -1 : 0
          if (sinal !== 0) compensar.set(t.account_id, (compensar.get(t.account_id) ?? 0) + sinal * t.amount)
        }
        for (const [conta, valor] of compensar) if (valor <= 0) compensar.delete(conta)

        // Onda 4 (fix 2, F2-A; fix 3, F3-C): a taxa que o adquirente/Asaas descontou do repasse (perform-match,
        // capture-fees) nasce PAGA sem DEBIT — a saída já está no crédito líquido; estornar e pagar de novo debitaria a
        // taxa 2x. Só recusa quando a AP não tem saída própria: a taxa estimada paga pelo Receber (DEBIT AP:<id>) ou
        // ligada a uma linha do banco estorna pelo (a)/(b) como qualquer AP.
        if (taxaDoAdquirente(ap) && compensar.size === 0 && ligadas.length === 0) {
          throw new RecusaEstorno('taxa descontada no repasse do adquirente — não estornável', 409)
        }

        // (c) legado: paga antes de 22/05 com conta e valor, sem nenhum lançamento próprio nem linha ligada.
        // Fix 3 (F3-A, espelho da AR): (ii) nenhuma saída já lançada da AP; (iii) conta criada antes de 22/05; (iv) updated_at
        // antigo OU a própria transação legada — DEBIT do ERP sem bank_ref, do valor pago, na conta da AP, antes de 22/05
        // e com descrição 'Pgto: ' (o valor sozinho casava o pagamento de outra AP).
        const pago = ap.paid_amount ?? 0
        const candidataLegado = paga && !!ap.account_id && pago > 0 && daAP.length === 0 && ligadas.length === 0
        const legado = candidataLegado
          && !!ap.created_at && ap.created_at.getTime() < LEGADO_ATE.getTime()
          && (await dinheiroDaAP(tx, user.companyId, ap.id)).total === 0
          && (
            (!!ap.updated_at && ap.updated_at.getTime() < LEGADO_ATE.getTime())
            || (await tx.transaction.count({
              where: {
                company_id: user.companyId, account_id: ap.account_id!, transaction_type: 'DEBIT', amount: pago,
                bank_ref: null, origin: null, created_at: { lt: LEGADO_ATE }, description: { startsWith: 'Pgto: ' },
              },
            })) > 0
          )
        if (legado) compensar.set(ap.account_id!, pago)

        if (ligadas.length === 0 && compensar.size === 0 && pago <= 0) throw new RecusaEstorno('nada a estornar', 400)

        exigirTravadas(travadas, [...ligadas.map((l) => l.account_id), ...compensar.keys()])

        await desligarLinhas(tx, user.companyId, ligadas)
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
      newValue: { status: 'PENDENTE', paid_amount: 0, motivo },
    })

    return success({ ok: true, payable_id: params.id })
  } catch (err) {
    return handleError(err)
  }
}
