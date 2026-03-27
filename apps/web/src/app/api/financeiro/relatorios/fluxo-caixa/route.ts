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
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const accountId = searchParams.get('account_id')

    // Default: last 6 months to now
    const now = new Date()
    const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    const startDate = from ? new Date(from) : defaultFrom
    const endDate = to ? new Date(to + 'T23:59:59') : defaultTo

    const baseWhere: any = {
      company_id: user.companyId,
      deleted_at: null,
      status: 'PAGO',
      due_date: { gte: startDate, lte: endDate },
    }

    // Fetch all paid receivables in range
    const receivables = await prisma.accountReceivable.findMany({
      where: baseWhere,
      select: { total_amount: true, received_amount: true, due_date: true },
    })

    // Fetch all paid payables in range
    const payables = await prisma.accountPayable.findMany({
      where: {
        ...baseWhere,
        ...(accountId ? {} : {}),
      },
      select: { total_amount: true, paid_amount: true, due_date: true },
    })

    // Build month keys from start to end
    const months: string[] = []
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
    while (cursor <= endDate) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
      months.push(key)
      cursor.setMonth(cursor.getMonth() + 1)
    }

    // Group by month
    const monthMap: Record<string, { entradas: number; saidas: number }> = {}
    for (const m of months) {
      monthMap[m] = { entradas: 0, saidas: 0 }
    }

    for (const r of receivables) {
      const d = new Date(r.due_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (monthMap[key]) {
        monthMap[key].entradas += r.received_amount ?? r.total_amount
      }
    }

    for (const p of payables) {
      const d = new Date(p.due_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (monthMap[key]) {
        monthMap[key].saidas += p.paid_amount ?? p.total_amount
      }
    }

    // Get initial balance from accounts
    let initialBalance = 0
    if (accountId) {
      const account = await prisma.account.findFirst({
        where: { id: accountId, company_id: user.companyId },
      })
      initialBalance = account?.initial_balance ?? 0
    }

    // Build result with accumulated balance
    let acumulado = initialBalance
    const data = months.map(month => {
      const { entradas, saidas } = monthMap[month]
      const saldo = entradas - saidas
      acumulado += saldo
      return {
        month,
        entradas,
        saidas,
        saldo,
        acumulado,
      }
    })

    const totalEntradas = data.reduce((s, d) => s + d.entradas, 0)
    const totalSaidas = data.reduce((s, d) => s + d.saidas, 0)

    return success({
      data,
      totais: {
        entradas: totalEntradas,
        saidas: totalSaidas,
        saldo: totalEntradas - totalSaidas,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}
