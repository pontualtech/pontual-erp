import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const createReceivableSchema = z.object({
  customer_id: z.string().optional(),
  service_order_id: z.string().optional(),
  description: z.string().min(1, 'Descricao e obrigatoria'),
  notes: z.string().optional(),
  total_amount: z.number().int().positive('Valor deve ser positivo'),
  due_date: z.string(),
  category_id: z.string().optional(),
  payment_method: z.string().optional(),
  installment_count: z.number().int().min(1).max(120).optional(),
})

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)))
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const customerId = searchParams.get('customerId')
    const search = searchParams.get('search')
    const categoryId = searchParams.get('categoryId')
    const paymentMethod = searchParams.get('paymentMethod')
    const valueMin = searchParams.get('valueMin')
    const valueMax = searchParams.get('valueMax')
    const dateType = searchParams.get('dateType') || 'vencimento'
    const bankAccountId = searchParams.get('bankAccountId')

    const where: any = { company_id: user.companyId, deleted_at: null }

    if (status) {
      if (status === 'VENCIDO') {
        where.status = 'PENDENTE'
        where.due_date = { lt: new Date() }
      } else {
        where.status = status
      }
    }

    if (customerId) where.customer_id = customerId
    if (categoryId) where.category_id = categoryId
    if (paymentMethod) where.payment_method = paymentMethod
    if (bankAccountId) where.bank_account_id = bankAccountId

    if (valueMin || valueMax) {
      where.total_amount = {}
      if (valueMin) where.total_amount.gte = Number(valueMin)
      if (valueMax) where.total_amount.lte = Number(valueMax)
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { customers: { legal_name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    // Determine which date field to filter based on dateType
    if (startDate || endDate) {
      if (dateType === 'emissao') {
        if (!where.created_at) where.created_at = {}
        if (startDate) where.created_at.gte = new Date(startDate)
        if (endDate) where.created_at.lte = new Date(endDate)
      } else if (dateType === 'pagamento') {
        where.status = 'RECEBIDO'
        if (!where.updated_at) where.updated_at = {}
        if (startDate) where.updated_at.gte = new Date(startDate)
        if (endDate) where.updated_at.lte = new Date(endDate)
      } else {
        // default: vencimento (due_date)
        if (!where.due_date) where.due_date = {}
        if (startDate) where.due_date.gte = new Date(startDate)
        if (endDate) where.due_date.lte = new Date(endDate)
      }
    }

    const [receivables, total, filteredAgg] = await Promise.all([
      prisma.accountReceivable.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { due_date: 'asc' },
        include: {
          customers: { select: { id: true, legal_name: true } },
          categories: { select: { id: true, name: true } },
        },
      }),
      prisma.accountReceivable.count({ where }),
      prisma.accountReceivable.aggregate({
        where,
        _sum: { total_amount: true },
      }),
    ])

    // Compute summary for top cards
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const [totalAberto, totalVencidas, vencendoHoje, recebidasMes] = await Promise.all([
      prisma.accountReceivable.aggregate({
        where: { company_id: user.companyId, deleted_at: null, status: 'PENDENTE' },
        _sum: { total_amount: true },
        _count: true,
      }),
      prisma.accountReceivable.aggregate({
        where: { company_id: user.companyId, deleted_at: null, status: 'PENDENTE', due_date: { lt: today } },
        _sum: { total_amount: true },
        _count: true,
      }),
      prisma.accountReceivable.aggregate({
        where: { company_id: user.companyId, deleted_at: null, status: 'PENDENTE', due_date: { gte: today, lt: tomorrow } },
        _sum: { total_amount: true },
        _count: true,
      }),
      prisma.accountReceivable.aggregate({
        where: { company_id: user.companyId, deleted_at: null, status: 'RECEBIDO', updated_at: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { total_amount: true },
        _count: true,
      }),
    ])

    return NextResponse.json({
      data: receivables,
      total,
      filteredSum: filteredAgg._sum.total_amount || 0,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        total_aberto: totalAberto._sum.total_amount || 0,
        total_aberto_count: totalAberto._count || 0,
        total_vencidas: totalVencidas._sum.total_amount || 0,
        total_vencidas_count: totalVencidas._count || 0,
        vencendo_hoje: vencendoHoje._sum.total_amount || 0,
        vencendo_hoje_count: vencendoHoje._count || 0,
        recebidas_mes: recebidasMes._sum.total_amount || 0,
        recebidas_mes_count: recebidasMes._count || 0,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = createReceivableSchema.parse(body)

    const installmentCount = data.installment_count || 1
    const isCard = data.payment_method && (data.payment_method.includes('Cartão') || data.payment_method.includes('Credito') || data.payment_method.includes('Crédito'))

    let cardFeeTotal = 0
    let netAmount = data.total_amount
    let daysToReceive = 0

    // Look up card fee config if paying by card with installments
    if (isCard && installmentCount >= 1) {
      const feeSettings = await prisma.setting.findMany({
        where: { company_id: user.companyId, key: { startsWith: 'card_fee.' } },
      })

      for (const setting of feeSettings) {
        try {
          const config = JSON.parse(setting.value)
          if ((data.payment_method && data.payment_method.includes(config.name)) || feeSettings.length === 1) {
            daysToReceive = config.days_to_receive || 30

            if (installmentCount === 1 && data.payment_method?.includes('Débito') && config.debit_fee_pct != null) {
              cardFeeTotal = Math.round(data.total_amount * config.debit_fee_pct / 100)
            } else if (Array.isArray(config.installments)) {
              for (const range of config.installments) {
                if (installmentCount >= range.from && installmentCount <= range.to) {
                  cardFeeTotal = Math.round(data.total_amount * range.fee_pct / 100)
                  break
                }
              }
            }
            netAmount = data.total_amount - cardFeeTotal
            break
          }
        } catch { /* skip invalid config */ }
      }
    }

    const receivable = await prisma.accountReceivable.create({
      data: {
        company_id: user.companyId,
        customer_id: data.customer_id || null,
        service_order_id: data.service_order_id || null,
        description: data.description,
        notes: data.notes,
        total_amount: data.total_amount,
        due_date: new Date(data.due_date),
        category_id: data.category_id || null,
        payment_method: data.payment_method,
        installment_count: installmentCount,
        card_fee_total: cardFeeTotal,
        net_amount: netAmount,
        status: 'PENDENTE',
      },
    })

    // Auto-generate installments if count > 1
    if (installmentCount > 1) {
      const baseAmount = Math.floor(netAmount / installmentCount)
      const remainder = netAmount - baseAmount * installmentCount
      const installments = []
      const baseDate = new Date(data.due_date)

      for (let i = 0; i < installmentCount; i++) {
        const dueDate = new Date(baseDate)
        if (isCard && daysToReceive > 0) {
          // Card: first installment after days_to_receive, then +30 days each
          if (i === 0) {
            dueDate.setDate(dueDate.getDate() + daysToReceive)
          } else {
            dueDate.setDate(dueDate.getDate() + daysToReceive + 30 * i)
          }
        } else {
          // Non-card: monthly from due date
          dueDate.setMonth(dueDate.getMonth() + i)
        }
        installments.push({
          company_id: user.companyId,
          parent_type: 'RECEIVABLE',
          parent_id: receivable.id,
          installment_number: i + 1,
          amount: i === 0 ? baseAmount + remainder : baseAmount,
          due_date: dueDate,
          status: 'PENDENTE',
        })
      }

      await prisma.installment.createMany({ data: installments })
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.create',
      entityId: receivable.id,
      newValue: { description: receivable.description, total_amount: receivable.total_amount, installments: installmentCount },
    })

    return success(receivable, 201)
  } catch (err) {
    return handleError(err)
  }
}
