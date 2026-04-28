import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { performMatch } from '@/lib/acquirer/perform-match'

/**
 * POST /api/financeiro/maquininha/match
 *
 * Vincula 1 acquirer_transaction a 1 service_order (match manual).
 * Cria atomicamente Payment + AR + 2 APs (MDR e RA) + nota interna.
 *
 * Body: { transaction_id: string, service_order_id: string }
 * Permission: financeiro.edit
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const { transaction_id, service_order_id } = await req.json()
    if (!transaction_id || !service_order_id) {
      return error('transaction_id e service_order_id obrigatorios', 400)
    }

    const r = await performMatch({
      transactionId: transaction_id,
      serviceOrderId: service_order_id,
      companyId: user.companyId,
      matchMethod: 'MANUAL',
    })
    if (!r.ok) {
      const code = /nao encontrad/i.test(r.error || '') ? 404 : 422
      return error(r.error || 'falha no match', code)
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'acquirer_match_manual',
      entityId: r.payment_id!,
      newValue: {
        transaction_id,
        os_number: r.os_number,
        amount: r.amount,
      },
    })

    return success({
      payment_id: r.payment_id,
      receivable_id: r.receivable_id,
      os_number: r.os_number,
      amount: r.amount,
    })
  } catch (err) {
    return handleError(err)
  }
}
