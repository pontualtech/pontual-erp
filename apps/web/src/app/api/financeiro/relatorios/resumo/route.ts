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
    const periodo = searchParams.get('periodo') || 'mes'

    const now = new Date()
    let startDate: Date
    let endDate: Date

    switch (periodo) {
      case 'trimestre':
        startDate = new Date(now.getFullYear(), now.getMonth() - 2, 1)
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
        break
      case 'ano':
        startDate = new Date(now.getFullYear(), 0, 1)
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59)
        break
      case 'mes':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
        break
    }

    const dateFilter = { gte: startDate, lte: endDate }
    const baseWhere = { company_id: user.companyId, deleted_at: null }

    // Total receivables and payables in period
    const [
      totalReceivables,
      totalPaid,
      totalPayables,
      totalReceived,
    ] = await Promise.all([
      prisma.accountReceivable.aggregate({
        where: { ...baseWhere, due_date: dateFilter },
        _sum: { total_amount: true, received_amount: true },
        _count: true,
      }),
      prisma.accountPayable.aggregate({
        where: { ...baseWhere, status: 'PAGO', due_date: dateFilter },
        _sum: { total_amount: true, paid_amount: true },
        _count: true,
      }),
      prisma.accountPayable.aggregate({
        where: { ...baseWhere, due_date: dateFilter },
        _sum: { total_amount: true, paid_amount: true },
        _count: true,
      }),
      prisma.accountReceivable.aggregate({
        where: { ...baseWhere, status: 'PAGO', due_date: dateFilter },
        _sum: { total_amount: true, received_amount: true },
        _count: true,
      }),
    ])

    // Top 5 categories by expense amount (payables)
    const payablesByCategory = await prisma.accountPayable.findMany({
      where: { ...baseWhere, due_date: dateFilter, status: 'PAGO' },
      select: {
        total_amount: true,
        paid_amount: true,
        categories: { select: { id: true, name: true } },
      },
    })

    const categoryMap: Record<string, { name: string; amount: number }> = {}
    for (const p of payablesByCategory) {
      const catName = p.categories?.name ?? 'Sem categoria'
      const catId = p.categories?.id ?? 'none'
      if (!categoryMap[catId]) {
        categoryMap[catId] = { name: catName, amount: 0 }
      }
      categoryMap[catId].amount += p.paid_amount ?? p.total_amount
    }

    const topCategories = Object.values(categoryMap)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)

    // Top 5 clients by revenue (receivables)
    const receivablesByClient = await prisma.accountReceivable.findMany({
      where: { ...baseWhere, due_date: dateFilter, status: 'PAGO' },
      select: {
        total_amount: true,
        received_amount: true,
        customers: { select: { id: true, legal_name: true } },
      },
    })

    const clientMap: Record<string, { name: string; amount: number }> = {}
    for (const r of receivablesByClient) {
      const clientName = r.customers?.legal_name ?? 'Sem cliente'
      const clientId = r.customers?.id ?? 'none'
      if (!clientMap[clientId]) {
        clientMap[clientId] = { name: clientName, amount: 0 }
      }
      clientMap[clientId].amount += r.received_amount ?? r.total_amount
    }

    const topClientes = Object.values(clientMap)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)

    const faturamento = totalReceived._sum.received_amount ?? totalReceived._sum.total_amount ?? 0
    const despesas = totalPaid._sum.paid_amount ?? totalPaid._sum.total_amount ?? 0

    return success({
      periodo,
      faturamento,
      despesas,
      resultado: faturamento - despesas,
      receivables: {
        total: totalReceivables._sum.total_amount ?? 0,
        received: totalReceivables._sum.received_amount ?? 0,
        count: totalReceivables._count,
      },
      payables: {
        total: totalPayables._sum.total_amount ?? 0,
        paid: totalPayables._sum.paid_amount ?? 0,
        count: totalPayables._count,
      },
      topCategories,
      topClientes,
    })
  } catch (err) {
    return handleError(err)
  }
}
