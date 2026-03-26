import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(_request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const basePayable: any = { company_id: user.companyId, deleted_at: null }
    const baseReceivable: any = { company_id: user.companyId, deleted_at: null }

    const [
      accounts,
      payableOpen,
      payableOverdue,
      receivableOpen,
      receivableOverdue,
    ] = await Promise.all([
      prisma.account.findMany({
        where: { company_id: user.companyId, is_active: true },
        select: { id: true, name: true, account_type: true, current_balance: true },
      }),

      prisma.accountPayable.aggregate({
        where: { ...basePayable, status: { in: ['PENDENTE'] } },
        _sum: { total_amount: true, paid_amount: true },
        _count: true,
      }),

      prisma.accountPayable.aggregate({
        where: { ...basePayable, status: 'PENDENTE', due_date: { lt: new Date() } },
        _sum: { total_amount: true, paid_amount: true },
        _count: true,
      }),

      prisma.accountReceivable.aggregate({
        where: { ...baseReceivable, status: { in: ['PENDENTE'] } },
        _sum: { total_amount: true, received_amount: true },
        _count: true,
      }),

      prisma.accountReceivable.aggregate({
        where: { ...baseReceivable, status: 'PENDENTE', due_date: { lt: new Date() } },
        _sum: { total_amount: true, received_amount: true },
        _count: true,
      }),
    ])

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
