import { NextRequest, NextResponse } from 'next/server'
import { withTenantTx } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(_request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const basePayable: any = { company_id: user.companyId, deleted_at: null }
    const baseReceivable: any = { company_id: user.companyId, deleted_at: null }

    // A7 fix (audit): wrap em withTenantTx pra strict-ready (M-007).
    // Em RLS lazy mode atual: no-op. Quando flipar PONTUAL_RLS_STRICT=1,
    // queries começam a respeitar `app.company_id` setado via SET LOCAL.
    const [
      accounts,
      payableOpen,
      payableOverdue,
      receivableOpen,
      receivableOverdue,
    ] = await withTenantTx(user.companyId, async (tx) => {
      return Promise.all([
        tx.account.findMany({
          where: { company_id: user.companyId, is_active: true },
          select: { id: true, name: true, account_type: true, current_balance: true },
        }),

        tx.accountPayable.aggregate({
          where: { ...basePayable, status: { in: ['PENDENTE'] } },
          _sum: { total_amount: true, paid_amount: true },
          _count: true,
        }),

        tx.accountPayable.aggregate({
          where: { ...basePayable, status: 'PENDENTE', due_date: { lt: new Date() } },
          _sum: { total_amount: true, paid_amount: true },
          _count: true,
        }),

        tx.accountReceivable.aggregate({
          where: { ...baseReceivable, status: { in: ['PENDENTE'] } },
          _sum: { total_amount: true, received_amount: true },
          _count: true,
        }),

        tx.accountReceivable.aggregate({
          where: { ...baseReceivable, status: 'PENDENTE', due_date: { lt: new Date() } },
          _sum: { total_amount: true, received_amount: true },
          _count: true,
        }),
      ])
    })

    const totalBalanceCents = accounts.reduce((s, a) => s + (a.current_balance ?? 0), 0)

    return success({
      totalBalanceCents,
      accounts,
      payable: {
        openCents: (payableOpen._sum.total_amount ?? 0) - (payableOpen._sum.paid_amount ?? 0),
        openCount: payableOpen._count,
        overdueCents: (payableOverdue._sum.total_amount ?? 0) - (payableOverdue._sum.paid_amount ?? 0),
        overdueCount: payableOverdue._count,
      },
      receivable: {
        openCents: (receivableOpen._sum.total_amount ?? 0) - (receivableOpen._sum.received_amount ?? 0),
        openCount: receivableOpen._count,
        overdueCents: (receivableOverdue._sum.total_amount ?? 0) - (receivableOverdue._sum.received_amount ?? 0),
        overdueCount: receivableOverdue._count,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}
