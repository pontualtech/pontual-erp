import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const days = Math.min(90, Math.max(7, Number(searchParams.get('days') || 30)))
    const startDate = new Date()
    const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

    // Wave AS-1 (2026-05-27): query AR em 2 grupos:
    //  (1) PENDENTE — cliente ainda não pagou, projeta pelo due_date
    //  (2) RECEBIDO awaiting credit — cliente pagou via Asaas crédito, gateway
    //      ainda não creditou (D+32 sem antecipação). Projeta pelo expected_credit_date.
    // Sem essa separação, ARs RECEBIDO via Asaas crédito "sumiam" do fluxo
    // imediatamente após o webhook (gap de até R$ 30k invisível por 32 dias).
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const [receivablesPending, receivablesAwaitingCredit, payables, accounts] = await Promise.all([
      prisma.accountReceivable.findMany({
        where: {
          company_id: user.companyId,
          deleted_at: null,
          status: 'PENDENTE',
          due_date: { gte: startDate, lte: endDate },
        },
        select: { id: true, description: true, total_amount: true, received_amount: true, due_date: true },
        orderBy: { due_date: 'asc' },
      }),
      prisma.accountReceivable.findMany({
        where: {
          company_id: user.companyId,
          deleted_at: null,
          status: 'RECEBIDO',
          expected_credit_date: { gt: today, lte: endDate },
        },
        select: { id: true, description: true, total_amount: true, received_amount: true, expected_credit_date: true },
        orderBy: { expected_credit_date: 'asc' },
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
    const totalReceivableCents = receivablesPending.reduce((sum, r) => sum + (r.total_amount - (r.received_amount || 0)), 0)
    const totalAwaitingCreditCents = receivablesAwaitingCredit.reduce((sum, r) => sum + (r.received_amount || r.total_amount), 0)
    const totalPayableCents = payables.reduce((sum, p) => sum + (p.total_amount - (p.paid_amount || 0)), 0)

    // Group by week for projection (2 inflow tracks separados)
    const weeks: { weekStart: string; inflow_pending: number; inflow_awaiting_credit: number; inflow: number; outflow: number; balance: number }[] = []
    let runningBalance = currentBalanceCents

    for (let d = 0; d < days; d += 7) {
      const weekStart = new Date(Date.now() + d * 24 * 60 * 60 * 1000)
      const weekEnd = new Date(Date.now() + (d + 7) * 24 * 60 * 60 * 1000)

      const weekInPending = receivablesPending
        .filter(r => r.due_date >= weekStart && r.due_date < weekEnd)
        .reduce((sum, r) => sum + (r.total_amount - (r.received_amount || 0)), 0)

      const weekInAwaiting = receivablesAwaitingCredit
        .filter(r => r.expected_credit_date && r.expected_credit_date >= weekStart && r.expected_credit_date < weekEnd)
        .reduce((sum, r) => sum + (r.received_amount || r.total_amount), 0)

      const weekOut = payables
        .filter(p => p.due_date >= weekStart && p.due_date < weekEnd)
        .reduce((sum, p) => sum + (p.total_amount - (p.paid_amount || 0)), 0)

      const weekIn = weekInPending + weekInAwaiting
      runningBalance = runningBalance + weekIn - weekOut

      weeks.push({
        weekStart: weekStart.toISOString().slice(0, 10),
        inflow_pending: weekInPending,
        inflow_awaiting_credit: weekInAwaiting,
        inflow: weekIn,
        outflow: weekOut,
        balance: runningBalance,
      })
    }

    return success({
      currentBalanceCents,
      totalReceivableCents,           // a receber (cliente ainda não pagou)
      totalAwaitingCreditCents,        // a creditar (cliente pagou, gateway não depositou ainda)
      totalPayableCents,
      projectedBalanceCents: runningBalance,
      accounts,
      weeks,
    })
  } catch (err) {
    return handleError(err)
  }
}
