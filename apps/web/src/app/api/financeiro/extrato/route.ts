import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/financeiro/extrato — Extrato financeiro completo
 *
 * Params: from, to, account_id, category_id, cost_center_id, search, page, limit
 */
export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const accountId = searchParams.get('account_id')
    const categoryId = searchParams.get('category_id')
    const costCenterId = searchParams.get('cost_center_id')
    const search = searchParams.get('search')
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') || 50)))

    const now = new Date()
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1)
    const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    const startDate = from ? new Date(from) : defaultFrom
    const endDate = to ? new Date(to + 'T23:59:59') : defaultTo

    // === CONTAS BANCÁRIAS ===
    const accounts = await prisma.account.findMany({
      where: { company_id: user.companyId, is_active: true },
      select: { id: true, name: true, bank_name: true, current_balance: true, initial_balance: true },
      orderBy: { name: 'asc' },
    })

    // === CATEGORIAS ===
    const categories = await prisma.category.findMany({
      where: { company_id: user.companyId },
      select: { id: true, name: true, module: true },
      orderBy: { name: 'asc' },
    })

    // === CENTROS DE CUSTO ===
    const costCenters = await prisma.costCenter.findMany({
      where: { company_id: user.companyId, is_active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    // === LANÇAMENTOS (Contas a Receber RECEBIDO) ===
    const arWhere: any = {
      company_id: user.companyId,
      deleted_at: null,
      status: 'RECEBIDO',
      due_date: { gte: startDate, lte: endDate },
    }
    if (categoryId) arWhere.category_id = categoryId
    if (search) arWhere.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { customers: { legal_name: { contains: search, mode: 'insensitive' } } },
    ]

    const receivables = await prisma.accountReceivable.findMany({
      where: arWhere,
      include: {
        customers: { select: { legal_name: true } },
        categories: { select: { name: true } },
      },
      orderBy: { due_date: 'desc' },
    })

    // === LANÇAMENTOS (Contas a Pagar PAGO) ===
    const apWhere: any = {
      company_id: user.companyId,
      deleted_at: null,
      status: 'PAGO',
      due_date: { gte: startDate, lte: endDate },
    }
    if (categoryId) apWhere.category_id = categoryId
    if (costCenterId) apWhere.cost_center_id = costCenterId
    if (search) apWhere.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { suppliers: { legal_name: { contains: search, mode: 'insensitive' } } },
    ]

    const payables = await prisma.accountPayable.findMany({
      where: apWhere,
      include: {
        categories: { select: { name: true } },
        cost_centers: { select: { name: true } },
      },
      orderBy: { due_date: 'desc' },
    })

    // === TRANSAÇÕES BANCÁRIAS (se filtro por conta) ===
    let bankTransactions: any[] = []
    if (accountId) {
      const txWhere: any = {
        company_id: user.companyId,
        account_id: accountId,
        transaction_date: { gte: startDate, lte: endDate },
      }
      if (search) txWhere.description = { contains: search, mode: 'insensitive' }

      bankTransactions = await prisma.transaction.findMany({
        where: txWhere,
        select: { id: true, amount: true, transaction_type: true, description: true, bank_ref: true, reconciled: true, transaction_date: true },
        orderBy: { transaction_date: 'desc' },
      })
    }

    // === MONTAR EXTRATO UNIFICADO ===
    type ExtratoItem = {
      id: string
      data: string
      descricao: string
      entidade: string
      conta_bancaria: string
      centro_custo: string
      categoria: string
      valor: number
      tipo: 'ENTRADA' | 'SAIDA'
      origem: 'receber' | 'pagar' | 'transacao'
      reconciliado?: boolean
    }

    const items: ExtratoItem[] = []

    // Entradas (recebimentos)
    for (const r of receivables) {
      items.push({
        id: r.id,
        data: r.due_date ? new Date(r.due_date).toISOString() : '',
        descricao: r.description,
        entidade: r.customers?.legal_name || '—',
        conta_bancaria: '—',
        centro_custo: '—',
        categoria: r.categories?.name || '—',
        valor: r.received_amount || r.total_amount,
        tipo: 'ENTRADA',
        origem: 'receber',
      })
    }

    // Saídas (pagamentos)
    for (const p of payables) {
      items.push({
        id: p.id,
        data: p.due_date ? new Date(p.due_date).toISOString() : '',
        descricao: p.description,
        entidade: '—',
        conta_bancaria: '—',
        centro_custo: p.cost_centers?.name || '—',
        categoria: p.categories?.name || '—',
        valor: p.paid_amount || p.total_amount,
        tipo: 'SAIDA',
        origem: 'pagar',
      })
    }

    // Transações bancárias (se filtro por conta)
    if (accountId) {
      const accountName = accounts.find(a => a.id === accountId)?.name || '—'
      for (const t of bankTransactions) {
        items.push({
          id: t.id,
          data: t.transaction_date ? new Date(t.transaction_date).toISOString() : '',
          descricao: t.description || `Transação ${t.bank_ref || ''}`,
          entidade: '—',
          conta_bancaria: accountName,
          centro_custo: '—',
          categoria: '—',
          valor: t.amount,
          tipo: t.transaction_type === 'CREDIT' ? 'ENTRADA' : 'SAIDA',
          origem: 'transacao',
          reconciliado: t.reconciled,
        })
      }
    }

    // Ordenar por data (mais recente primeiro)
    items.sort((a, b) => b.data.localeCompare(a.data))

    // Calcular resumo
    const totalEntradas = items.filter(i => i.tipo === 'ENTRADA').reduce((s, i) => s + i.valor, 0)
    const totalSaidas = items.filter(i => i.tipo === 'SAIDA').reduce((s, i) => s + i.valor, 0)
    const saldoPeriodo = totalEntradas - totalSaidas

    // Saldo bancário
    const saldoAnterior = accountId
      ? accounts.find(a => a.id === accountId)?.initial_balance ?? 0
      : accounts.reduce((s, a) => s + (a.initial_balance ?? 0), 0)
    const saldoAtual = accountId
      ? accounts.find(a => a.id === accountId)?.current_balance ?? 0
      : accounts.reduce((s, a) => s + (a.current_balance ?? 0), 0)

    // Paginar
    const total = items.length
    const paginatedItems = items.slice((page - 1) * limit, page * limit)

    return success({
      items: paginatedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      resumo: {
        saldo_anterior: saldoAnterior,
        entradas: totalEntradas,
        saidas: totalSaidas,
        saldo_periodo: saldoPeriodo,
        saldo_atual: saldoAtual,
      },
      contas: accounts,
      categorias: categories,
      centros_custo: costCenters,
    })
  } catch (err) {
    return handleError(err)
  }
}
