import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const days = Math.min(90, Math.max(7, Number(searchParams.get('days') || 30)))
    const startDate = new Date()
    const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

    const [receivables, payables, accounts] = await Promise.all([
      prisma.accountReceivable.findMany({
        where: {
          company_id: user.companyId,
          deleted_at: null,
          status: { in: ['PENDENTE'] },
          due_date: { gte: startDate, lte: endDate },
        },
        select: { id: true, description: true, total_amount: true, received_amount: true, due_date: true, status: true },
        orderBy: { due_date: 'asc' },
      }),
      prisma.accountPayable.findMany({
        where: {
          company_id: user.companyId,
          deleted_at: null,
          status: { in: ['PENDENTE'] },
          due_date: { gte: startDate, lte: endDate },
        },
        select: { id: true, description: true, total_amount: true, paid_amount: true, due_date: true, status: true },
        orderBy: { due_date: 'asc' },
      }),
      prisma.account.findMany({
        where: { company_id: user.companyId, is_active: true },
        select: { id: true, name: true, account_type: true, current_balance: true },
      }),
    ])

    const currentBalanceCents = accounts.reduce((sum, a) => sum + (a.current_balance ?? 0), 0)
    const totalReceivableCents = receivables.reduce((sum, r) => sum + (r.total_amount - (r.received_amount ?? 0)), 0)
    const totalPayableCents = payables.reduce((sum, p) => sum + (p.total_amount - (p.paid_amount ?? 0)), 0)

    // Group by week for projection
    const weeks: { weekStart: string; inflow: number; outflow: number; balance: number }[] = []
    let runningBalance = currentBalanceCents

    for (let d = 0; d < days; d += 7) {
      const weekStart = new Date(Date.now() + d * 24 * 60 * 60 * 1000)
      const weekEnd = new Date(Date.now() + (d + 7) * 24 * 60 * 60 * 1000)

      const weekIn = receivables
        .filter(r => r.due_date >= weekStart && r.due_date < weekEnd)
        .reduce((sum, r) => sum + (r.total_amount - (r.received_amount ?? 0)), 0)

      const weekOut = payables
        .filter(p => p.due_date >= weekStart && p.due_date < weekEnd)
        .reduce((sum, p) => sum + (p.total_amount - (p.paid_amount ?? 0)), 0)

      runningBalance = runningBalance + weekIn - weekOut

      weeks.push({
        weekStart: weekStart.toISOString().slice(0, 10),
        inflow: weekIn,
        outflow: weekOut,
        balance: runningBalance,
      })
    }

    return success({
      currentBalanceCents,
      totalReceivableCents,
      totalPayableCents,
      projectedBalanceCents: runningBalance,
      accounts,
      weeks,
    })
  } catch (err) {
    return handleError(err)
  }
}
