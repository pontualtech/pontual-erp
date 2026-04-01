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
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    // Default: mês corrente até 11 meses à frente
    const now = new Date()
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1)
    const defaultTo = new Date(now.getFullYear(), now.getMonth() + 12, 0, 23, 59, 59)

    const startDate = from ? new Date(from) : defaultFrom
    const endDate = to ? new Date(to + 'T23:59:59') : defaultTo

    // Buscar recebimentos (status RECEBIDO)
    const receivables = await prisma.accountReceivable.findMany({
      where: {
        company_id: user.companyId,
        deleted_at: null,
        status: 'RECEBIDO',
        due_date: { gte: startDate, lte: endDate },
      },
      select: { total_amount: true, received_amount: true, due_date: true },
    })

    // Buscar pagamentos (status PAGO)
    const payables = await prisma.accountPayable.findMany({
      where: {
        company_id: user.companyId,
        deleted_at: null,
        status: 'PAGO',
        due_date: { gte: startDate, lte: endDate },
      },
      select: { total_amount: true, paid_amount: true, due_date: true },
    })

    // Buscar saldo inicial de TODAS as contas bancárias ativas
    const accounts = await prisma.account.findMany({
      where: { company_id: user.companyId, is_active: true },
      select: { id: true, name: true, current_balance: true, initial_balance: true },
    })
    const saldoBancarioAtual = accounts.reduce((sum, a) => sum + (a.current_balance ?? 0), 0)

    // Buscar transações no período (fonte mais precisa de movimentação)
    const transactions = await prisma.transaction.findMany({
      where: {
        company_id: user.companyId,
        transaction_date: { gte: startDate, lte: endDate },
      },
      select: { amount: true, transaction_type: true, transaction_date: true },
    })

    // Build month keys
    const months: string[] = []
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
    while (cursor <= endDate) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
      months.push(key)
      cursor.setMonth(cursor.getMonth() + 1)
    }

    // Agrupar por mês — priorizar Transactions se existem, senão usar receivables/payables
    const monthMap: Record<string, { entradas: number; saidas: number }> = {}
    for (const m of months) {
      monthMap[m] = { entradas: 0, saidas: 0 }
    }

    if (transactions.length > 0) {
      // Usar transações bancárias (mais preciso)
      for (const t of transactions) {
        const d = new Date(t.transaction_date)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (monthMap[key]) {
          if (t.transaction_type === 'CREDIT') {
            monthMap[key].entradas += t.amount
          } else {
            monthMap[key].saidas += t.amount
          }
        }
      }
    } else {
      // Fallback: usar receivables/payables
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
    }

    // Build result with accumulated balance
    // Acumulado começa do saldo total das contas bancárias
    let acumulado = saldoBancarioAtual
    // Subtrair movimentação futura para achar o saldo no início do período
    const totalEntradasAll = Object.values(monthMap).reduce((s, m) => s + m.entradas, 0)
    const totalSaidasAll = Object.values(monthMap).reduce((s, m) => s + m.saidas, 0)
    // Se temos transações, o saldo atual já reflete tudo — então o acumulado no início é saldo - movimentação do período
    if (transactions.length > 0) {
      acumulado = saldoBancarioAtual - (totalEntradasAll - totalSaidasAll)
    }

    const data = months.map(month => {
      const { entradas, saidas } = monthMap[month]
      const saldo = entradas - saidas
      acumulado += saldo
      return { month, entradas, saidas, saldo, acumulado }
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
      saldoBancario: saldoBancarioAtual,
      contas: accounts.map(a => ({ id: a.id, name: a.name, balance: a.current_balance ?? 0 })),
    })
  } catch (err) {
    return handleError(err)
  }
}
