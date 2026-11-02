import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import {
  CONFLITO_BANCO, conflitoDeBanco, ContaAlterada, contasDaAP, descreverDinheiro, dinheiroDaAP, exigirTravadas, posAjuste, travarContas,
  type LancamentoDaConta,
} from '@/lib/financeiro/livro-baixa-db'

/**
 * POST /api/financeiro/contas-pagar/[id]/estornar
 *
 * C10 fix 22/05: estorno de AP ja paga. Espelho do estorno de AR, travas contas → AP (§7), tudo relido na tx.
 * Fix 8 (F8-A, §0): com saída lançada (linhas do banco ligadas a AP:<id>, DEBIT AP:<id> vivo) o estorno PERGUNTA —
 * sem `dinheiro`, 409 ESTORNO_PERGUNTA: 'permanece' (engano: o dinheiro continua no banco) → CREDIT AP:<id>:estorno na
 * conta de cada saída, sem desligar linhas (nocional anterior ao ajuste não — F8-B); 'devolvido' (voltou do fornecedor)
 * → só status. Sem saída: legado (paga antes de 22/05/2026, DEBIT sem bank_ref) → CREDIT pelo paid_amount na conta da
 * AP; senão só status. PENDENTE sem valor pago → 400 'nada a estornar'. Desligar linhas só no Desfazer.
 *
 * Antes, mexer em AP paga só era possível via DELETE (soft delete) que
 * deixava a Transaction DEBIT órfã + saldo deflacionado sem rastro.
 */
type Params = { params: { id: string } }

// Fix 8 (F8-A, espelho da AR): a conta tem saída lançada e o operador não disse se o dinheiro voltou ou continua no banco.
class PerguntaEstorno extends Error {
  constructor(readonly lancados: LancamentoDaConta[]) {
    super('O dinheiro deste pagamento voltou do fornecedor, ou continua no banco (lançado na conta errada/por engano)?')
  }
}

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
    const escolha = (body as any)?.dinheiro as unknown
    if (escolha !== undefined && escolha !== 'permanece' && escolha !== 'devolvido') {
      return error("dinheiro deve ser 'permanece' ou 'devolvido'", 400)
    }

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
        if (dinheiro.total > 0) {
          if (!escolha) throw new PerguntaEstorno(await descreverDinheiro(tx, user.companyId, dinheiro))
          // 'permanece' → como em produção, CREDIT AP:<id>:estorno NA CONTA de cada saída, sem desligar linhas; nocional
          // anterior ao ajuste não (F8-B). 'devolvido' → só status (a entrada da devolução vem pelo extrato).
          if (escolha === 'permanece') {
            for (const t of [...dinheiro.linhas, ...await posAjuste(tx, user.companyId, dinheiro.nocionais)]) {
              const vivo = t.vivo ?? t.amount
              if (vivo > 0) compensar.set(t.account_id, (compensar.get(t.account_id) ?? 0) + vivo)
            }
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
          if (legado) compensar.set(ap.account_id!, pago)
          // Quitada sem valor, sem dinheiro e sem legado: nada a estornar.
          if (!legado && pago <= 0) throw new RecusaEstorno('nada a estornar', 400)
        }

        exigirTravadas(travadas, [...compensar.keys()])

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
      newValue: { status: 'PENDENTE', paid_amount: 0, motivo },
    })

    return success({ ok: true, payable_id: params.id })
  } catch (err) {
    return handleError(err)
  }
}
