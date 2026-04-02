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
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')

    const now = new Date()
    const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    const startDate = fromParam ? new Date(fromParam) : defaultFrom
    const endDate = toParam ? new Date(toParam + 'T23:59:59') : defaultTo

    const baseWhere = { company_id: user.companyId, deleted_at: null }

    // ========== AGING REPORT (Contas a Receber por Idade) ==========
    const pendingReceivables = await prisma.accountReceivable.findMany({
      where: {
        ...baseWhere,
        status: { in: ['PENDENTE', 'ATRASADO'] },
      },
      select: {
        id: true,
        total_amount: true,
        received_amount: true,
        due_date: true,
        description: true,
        customers: { select: { legal_name: true } },
      },
    })

    const aging = { current: 0, days30: 0, days60: 0, days90: 0, days90plus: 0 }
    const agingItems: { bracket: string; customer: string; description: string; amount: number; due_date: string; days_overdue: number }[] = []

    for (const r of pendingReceivables) {
      const amount = r.total_amount - (r.received_amount ?? 0)
      if (amount <= 0) continue
      const dueDate = new Date(r.due_date)
      const diffMs = now.getTime() - dueDate.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      let bracket: string
      if (diffDays <= 0) {
        aging.current += amount
        bracket = 'A vencer'
      } else if (diffDays <= 30) {
        aging.days30 += amount
        bracket = '1-30 dias'
      } else if (diffDays <= 60) {
        aging.days60 += amount
        bracket = '31-60 dias'
      } else if (diffDays <= 90) {
        aging.days90 += amount
        bracket = '61-90 dias'
      } else {
        aging.days90plus += amount
        bracket = '90+ dias'
      }

      agingItems.push({
        bracket,
        customer: r.customers?.legal_name ?? 'Sem cliente',
        description: r.description,
        amount,
        due_date: r.due_date.toISOString().slice(0, 10),
        days_overdue: Math.max(0, diffDays),
      })
    }

    agingItems.sort((a, b) => b.days_overdue - a.days_overdue)

    // ========== TOP CLIENTES (by revenue) ==========
    const receivablesByClient = await prisma.accountReceivable.findMany({
      where: {
        ...baseWhere,
        status: { in: ['RECEBIDO', 'PAGO'] },
        due_date: { gte: startDate, lte: endDate },
      },
      select: {
        total_amount: true,
        received_amount: true,
        customers: { select: { id: true, legal_name: true } },
      },
    })

    const clientMap: Record<string, { name: string; amount: number }> = {}
    for (const r of receivablesByClient) {
      const clientId = r.customers?.id ?? 'none'
      const clientName = r.customers?.legal_name ?? 'Sem cliente'
      if (!clientMap[clientId]) clientMap[clientId] = { name: clientName, amount: 0 }
      clientMap[clientId].amount += r.received_amount ?? r.total_amount
    }
    const topClientes = Object.values(clientMap)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)

    // ========== TOP FORNECEDORES (by expense) ==========
    const payablesBySupplier = await prisma.accountPayable.findMany({
      where: {
        ...baseWhere,
        status: 'PAGO',
        due_date: { gte: startDate, lte: endDate },
      },
      select: {
        total_amount: true,
        paid_amount: true,
        customers: { select: { id: true, legal_name: true } },
      },
    })

    const supplierMap: Record<string, { name: string; amount: number }> = {}
    for (const p of payablesBySupplier) {
      const supplierId = p.customers?.id ?? 'none'
      const supplierName = p.customers?.legal_name ?? 'Sem fornecedor'
      if (!supplierMap[supplierId]) supplierMap[supplierId] = { name: supplierName, amount: 0 }
      supplierMap[supplierId].amount += p.paid_amount ?? p.total_amount
    }
    const topFornecedores = Object.values(supplierMap)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)

    // ========== RESUMO MENSAL (last 12 months) ==========
    const monthlyReceivables = await prisma.accountReceivable.findMany({
      where: {
        ...baseWhere,
        status: { in: ['RECEBIDO', 'PAGO'] },
        due_date: { gte: startDate, lte: endDate },
      },
      select: { received_amount: true, total_amount: true, due_date: true },
    })

    const monthlyPayables = await prisma.accountPayable.findMany({
      where: {
        ...baseWhere,
        status: 'PAGO',
        due_date: { gte: startDate, lte: endDate },
      },
      select: { paid_amount: true, total_amount: true, due_date: true },
    })

    // Build month keys
    const monthKeys: string[] = []
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
    while (cursor <= endDate) {
      monthKeys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
      cursor.setMonth(cursor.getMonth() + 1)
    }

    const monthlyMap: Record<string, { receitas: number; despesas: number }> = {}
    for (const mk of monthKeys) {
      monthlyMap[mk] = { receitas: 0, despesas: 0 }
    }

    for (const r of monthlyReceivables) {
      const d = new Date(r.due_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (monthlyMap[key]) {
        monthlyMap[key].receitas += r.received_amount ?? r.total_amount
      }
    }

    for (const p of monthlyPayables) {
      const d = new Date(p.due_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (monthlyMap[key]) {
        monthlyMap[key].despesas += p.paid_amount ?? p.total_amount
      }
    }

    const resumoMensal = monthKeys.map(month => ({
      month,
      receitas: monthlyMap[month].receitas,
      despesas: monthlyMap[month].despesas,
      resultado: monthlyMap[month].receitas - monthlyMap[month].despesas,
    }))

    return success({
      aging: {
        summary: aging,
        total: aging.current + aging.days30 + aging.days60 + aging.days90 + aging.days90plus,
        items: agingItems.slice(0, 50),
      },
      topClientes,
      topFornecedores,
      resumoMensal,
    })
  } catch (err) {
    return handleError(err)
  }
}
