import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const createPayableSchema = z.object({
  supplier_id: z.string().optional(),
  description: z.string().min(1, 'Descricao e obrigatoria'),
  notes: z.string().optional(),
  total_amount: z.number().int().positive('Valor deve ser positivo'),
  due_date: z.string(),
  category_id: z.string().optional(),
  cost_center_id: z.string().optional(),
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
    const supplierId = searchParams.get('supplierId')
    const search = searchParams.get('search')
    const categoryId = searchParams.get('categoryId')
    const costCenterId = searchParams.get('costCenterId')
    const paymentMethod = searchParams.get('paymentMethod')
    const valueMin = searchParams.get('valueMin') ? Number(searchParams.get('valueMin')) : null
    const valueMax = searchParams.get('valueMax') ? Number(searchParams.get('valueMax')) : null

    const where: any = { company_id: user.companyId, deleted_at: null }

    if (status) {
      if (status === 'VENCIDO') {
        where.status = 'PENDENTE'
        where.due_date = { lt: new Date() }
      } else {
        where.status = status
      }
    }

    if (supplierId) where.supplier_id = supplierId
    if (categoryId) where.category_id = categoryId
    if (costCenterId) where.cost_center_id = costCenterId
    if (paymentMethod) where.payment_method = paymentMethod
    if (valueMin !== null || valueMax !== null) {
      where.total_amount = {}
      if (valueMin !== null) where.total_amount.gte = valueMin
      if (valueMax !== null) where.total_amount.lte = valueMax
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { customers: { legal_name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    if (startDate || endDate) {
      if (!where.due_date) where.due_date = {}
      if (startDate) where.due_date.gte = new Date(startDate)
      if (endDate) where.due_date.lte = new Date(endDate)
    }

    const [payables, total] = await Promise.all([
      prisma.accountPayable.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { due_date: 'asc' },
        include: {
          customers: { select: { id: true, legal_name: true } },
          categories: { select: { id: true, name: true } },
          cost_centers: { select: { id: true, name: true } },
        },
      }),
      prisma.accountPayable.count({ where }),
    ])

    // Compute summary for top cards
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const summaryRows = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'PENDENTE' THEN total_amount ELSE 0 END), 0) as aberto_sum,
        COUNT(CASE WHEN status = 'PENDENTE' THEN 1 END) as aberto_count,
        COALESCE(SUM(CASE WHEN status = 'PENDENTE' AND due_date < $1 THEN total_amount ELSE 0 END), 0) as vencidas_sum,
        COUNT(CASE WHEN status = 'PENDENTE' AND due_date < $1 THEN 1 END) as vencidas_count,
        COALESCE(SUM(CASE WHEN status = 'PENDENTE' AND due_date >= $1 AND due_date < $2 THEN total_amount ELSE 0 END), 0) as hoje_sum,
        COUNT(CASE WHEN status = 'PENDENTE' AND due_date >= $1 AND due_date < $2 THEN 1 END) as hoje_count,
        COALESCE(SUM(CASE WHEN status = 'PAGO' AND updated_at >= $3 AND updated_at <= $4 THEN total_amount ELSE 0 END), 0) as pagas_sum,
        COUNT(CASE WHEN status = 'PAGO' AND updated_at >= $3 AND updated_at <= $4 THEN 1 END) as pagas_count
      FROM accounts_payable
      WHERE company_id = $5 AND deleted_at IS NULL
    `, today, tomorrow, startOfMonth, endOfMonth, user.companyId) as any[]

    const s = summaryRows[0] || {}
    const totalAberto = { _sum: { total_amount: Number(s.aberto_sum) || 0 }, _count: Number(s.aberto_count) || 0 }
    const totalVencidas = { _sum: { total_amount: Number(s.vencidas_sum) || 0 }, _count: Number(s.vencidas_count) || 0 }
    const vencendoHoje = { _sum: { total_amount: Number(s.hoje_sum) || 0 }, _count: Number(s.hoje_count) || 0 }
    const pagasMes = { _sum: { total_amount: Number(s.pagas_sum) || 0 }, _count: Number(s.pagas_count) || 0 }

    // Filter options for dropdowns
    const [filterCategories, filterCostCenters] = await Promise.all([
      prisma.category.findMany({ where: { company_id: user.companyId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.costCenter.findMany({ where: { company_id: user.companyId, is_active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])

    // Distinct payment methods from existing payables
    const distinctPM = await prisma.accountPayable.findMany({
      where: { company_id: user.companyId, deleted_at: null, payment_method: { not: null } },
      distinct: ['payment_method'],
      select: { payment_method: true },
    })

    return NextResponse.json({
      data: payables,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      filters: {
        categories: filterCategories,
        cost_centers: filterCostCenters,
        payment_methods: distinctPM.map(p => p.payment_method).filter(Boolean).sort(),
      },
      summary: {
        total_aberto: totalAberto._sum.total_amount || 0,
        total_aberto_count: totalAberto._count || 0,
        total_vencidas: totalVencidas._sum.total_amount || 0,
        total_vencidas_count: totalVencidas._count || 0,
        vencendo_hoje: vencendoHoje._sum.total_amount || 0,
        vencendo_hoje_count: vencendoHoje._count || 0,
        pagas_mes: pagasMes._sum.total_amount || 0,
        pagas_mes_count: pagasMes._count || 0,
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
    const data = createPayableSchema.parse(body)

    const installmentCount = data.installment_count || 1

    const payable = await prisma.accountPayable.create({
      data: {
        company_id: user.companyId,
        supplier_id: data.supplier_id || null,
        description: data.description,
        notes: data.notes,
        total_amount: data.total_amount,
        due_date: new Date(data.due_date),
        category_id: data.category_id || null,
        cost_center_id: data.cost_center_id || null,
        payment_method: data.payment_method,
        status: 'PENDENTE',
      },
    })

    // Auto-generate installments if count > 1
    if (installmentCount > 1) {
      const baseAmount = Math.floor(data.total_amount / installmentCount)
      const remainder = data.total_amount - baseAmount * installmentCount
      const installments = []
      const baseDate = new Date(data.due_date)

      for (let i = 0; i < installmentCount; i++) {
        const dueDate = new Date(baseDate)
        dueDate.setMonth(dueDate.getMonth() + i)
        installments.push({
          company_id: user.companyId,
          parent_type: 'PAYABLE',
          parent_id: payable.id,
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
      action: 'payable.create',
      entityId: payable.id,
      newValue: { description: payable.description, total_amount: payable.total_amount, installments: installmentCount },
    })

    return success(payable, 201)
  } catch (err) {
    return handleError(err)
  }
}
