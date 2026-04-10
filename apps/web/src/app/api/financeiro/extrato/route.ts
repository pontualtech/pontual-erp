import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/financeiro/extrato — Extrato financeiro completo
 *
 * Params: from, to, account_id, category_id, cost_center_id, search, page, limit,
 *         tipo (ENTRADA|SAIDA), payment_method, value_min, value_max, origem (receber|pagar|transacao)
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
    const tipo = searchParams.get('tipo') // ENTRADA | SAIDA
    const paymentMethod = searchParams.get('payment_method')
    const valueMin = searchParams.get('value_min') ? Number(searchParams.get('value_min')) : null
    const valueMax = searchParams.get('value_max') ? Number(searchParams.get('value_max')) : null
    const origem = searchParams.get('origem') // receber | pagar | transacao
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(10000, Math.max(1, Number(searchParams.get('limit') || 50)))

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
    // Quando filtra por conta bancária ou centro de custo, exclui receivables pois não possuem esses campos
    const skipReceber = tipo === 'SAIDA' || origem === 'pagar' || origem === 'transacao' || !!accountId || !!costCenterId
    const arWhere: any = {
      company_id: user.companyId,
      deleted_at: null,
      status: 'RECEBIDO',
      due_date: { gte: startDate, lte: endDate },
    }
    if (categoryId) arWhere.category_id = categoryId
    if (paymentMethod) arWhere.payment_method = paymentMethod
    if (search) arWhere.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { customers: { legal_name: { contains: search, mode: 'insensitive' } } },
    ]

    const receivables = skipReceber ? [] : await prisma.accountReceivable.findMany({
      where: arWhere,
      include: {
        customers: { select: { legal_name: true } },
        categories: { select: { name: true } },
      },
      orderBy: { due_date: 'desc' },
    })

    // === LANÇAMENTOS (Contas a Pagar PAGO) ===
    const skipPagar = tipo === 'ENTRADA' || origem === 'receber' || origem === 'transacao' || !!accountId
    const apWhere: any = {
      company_id: user.companyId,
      deleted_at: null,
      status: 'PAGO',
      due_date: { gte: startDate, lte: endDate },
    }
    if (categoryId) apWhere.category_id = categoryId
    if (costCenterId) apWhere.cost_center_id = costCenterId
    if (paymentMethod) apWhere.payment_method = paymentMethod
    if (search) apWhere.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { suppliers: { legal_name: { contains: search, mode: 'insensitive' } } },
    ]

    const payables = skipPagar ? [] : await prisma.accountPayable.findMany({
      where: apWhere,
      include: {
        categories: { select: { name: true } },
        cost_centers: { select: { name: true } },
        customers: { select: { legal_name: true } },
      },
      orderBy: { due_date: 'desc' },
    })

    // === TRANSAÇÕES BANCÁRIAS (se filtro por conta) ===
    const skipTransacao = origem === 'receber' || origem === 'pagar'
    let bankTransactions: any[] = []
    if (accountId && !skipTransacao) {
      const txWhere: any = {
        company_id: user.companyId,
        account_id: accountId,
        transaction_date: { gte: startDate, lte: endDate },
      }
      if (search) txWhere.description = { contains: search, mode: 'insensitive' }
      if (tipo === 'ENTRADA') txWhere.transaction_type = 'CREDIT'
      if (tipo === 'SAIDA') txWhere.transaction_type = 'DEBIT'

      bankTransactions = await prisma.transaction.findMany({
        where: txWhere,
        select: { id: true, amount: true, transaction_type: true, description: true, bank_ref: true, reconciled: true, transaction_date: true },
        orderBy: { transaction_date: 'desc' },
      })
    }

    // === FORMAS DE PAGAMENTO DISTINTAS ===
    const paymentMethods = new Set<string>()
    receivables.forEach(r => r.payment_method && paymentMethods.add(r.payment_method))
    payables.forEach(p => p.payment_method && paymentMethods.add(p.payment_method))

    // === MONTAR EXTRATO UNIFICADO ===
    type ExtratoItem = {
      id: string
      data: string
      descricao: string
      entidade: string
      conta_bancaria: string
      centro_custo: string
      categoria: string
      forma_pagamento: string
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
        forma_pagamento: r.payment_method || '—',
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
        entidade: p.customers?.legal_name || '—',
        conta_bancaria: '—',
        centro_custo: p.cost_centers?.name || '—',
        categoria: p.categories?.name || '—',
        forma_pagamento: p.payment_method || '—',
        valor: p.paid_amount || p.total_amount,
        tipo: 'SAIDA',
        origem: 'pagar',
      })
    }

    // Transações bancárias (se filtro por conta)
    if (accountId && !skipTransacao) {
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
          forma_pagamento: '—',
          valor: t.amount,
          tipo: t.transaction_type === 'CREDIT' ? 'ENTRADA' : 'SAIDA',
          origem: 'transacao',
          reconciliado: t.reconciled,
        })
      }
    }

    // Filtro por valor (min/max em centavos)
    if (valueMin !== null) {
      const minCents = Math.round(valueMin * 100)
      const idx = items.length
      for (let i = idx - 1; i >= 0; i--) {
        if (items[i].valor < minCents) items.splice(i, 1)
      }
    }
    if (valueMax !== null) {
      const maxCents = Math.round(valueMax * 100)
      const idx = items.length
      for (let i = idx - 1; i >= 0; i--) {
        if (items[i].valor > maxCents) items.splice(i, 1)
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
      formas_pagamento: Array.from(paymentMethods).sort(),
    })
  } catch (err) {
    return handleError(err)
  }
}
