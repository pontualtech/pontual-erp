import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const splitSchema = z.object({
  payment_method: z.string().optional(),
  account_id: z.string().optional(),
  amount: z.number().int().positive('Valor do split deve ser positivo'),
  installment_count: z.number().int().min(1).max(60).optional(), // M7 fix 22/05: cap 60 (era 120)
})

const createPayableSchema = z.object({
  supplier_id: z.string().optional(),
  description: z.string().min(1, 'Descrição é obrigatória'),
  notes: z.string().optional(),
  total_amount: z.number().int().positive('Valor deve ser positivo'),
  due_date: z.string(),
  category_id: z.string().optional(),
  cost_center_id: z.string().optional(),
  account_id: z.string().optional(), // Sprint UX-24: banco origem do pagamento (Itau, Asaas, etc)
  payment_method: z.string().optional(),
  installment_count: z.number().int().min(1).max(60).optional(), // M7 fix 22/05: cap 60 (era 120)
  // Split payment 2026-05-19: se splits[] vier, cria N payables agrupados via group_id
  splits: z.array(splitSchema).optional(),
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
    // Sprint UX-24: filtro por banco vinculado (account_id)
    const bankAccountId = searchParams.get('bankAccountId')
    // Wave S (2026-05-24): filtro reconciliação bancária (mesmo padrão AR).
    const reconciledParam = searchParams.get('reconciled')

    const where: any = { company_id: user.companyId, deleted_at: null }

    if (reconciledParam === 'false' || reconciledParam === 'pending') {
      where.reconciled = false
    } else if (reconciledParam === 'true' || reconciledParam === 'done') {
      where.reconciled = true
    }

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
    if (bankAccountId) where.account_id = bankAccountId
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

    // M-006: refactor $queryRawUnsafe → $queryRaw tagged template literal.
    // Endereça P-013 (anti-pattern flagged em audits estáticos). SQL é estática
    // — risco real de injection era zero, mas $queryRaw é a forma idiomática.
    // Status hardcoded ('PENDENTE','PAGO') será refatorado pra enum em fase
    // posterior (M-012 backfill + conversão schema).
    type PayableSummaryRow = {
      aberto_sum: bigint | number; aberto_count: bigint
      vencidas_sum: bigint | number; vencidas_count: bigint
      hoje_sum: bigint | number; hoje_count: bigint
      pagas_sum: bigint | number; pagas_count: bigint
    }
    const summaryRows = await prisma.$queryRaw<PayableSummaryRow[]>`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'PENDENTE' THEN total_amount ELSE 0 END), 0) as aberto_sum,
        COUNT(CASE WHEN status = 'PENDENTE' THEN 1 END) as aberto_count,
        COALESCE(SUM(CASE WHEN status = 'PENDENTE' AND due_date < ${today} THEN total_amount ELSE 0 END), 0) as vencidas_sum,
        COUNT(CASE WHEN status = 'PENDENTE' AND due_date < ${today} THEN 1 END) as vencidas_count,
        COALESCE(SUM(CASE WHEN status = 'PENDENTE' AND due_date >= ${today} AND due_date < ${tomorrow} THEN total_amount ELSE 0 END), 0) as hoje_sum,
        COUNT(CASE WHEN status = 'PENDENTE' AND due_date >= ${today} AND due_date < ${tomorrow} THEN 1 END) as hoje_count,
        COALESCE(SUM(CASE WHEN status = 'PAGO' AND updated_at >= ${startOfMonth} AND updated_at <= ${endOfMonth} THEN total_amount ELSE 0 END), 0) as pagas_sum,
        COUNT(CASE WHEN status = 'PAGO' AND updated_at >= ${startOfMonth} AND updated_at <= ${endOfMonth} THEN 1 END) as pagas_count
      FROM accounts_payable
      WHERE company_id = ${user.companyId} AND deleted_at IS NULL
    `

    const s: Partial<PayableSummaryRow> = summaryRows[0] ?? {}
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

/**
 * Cria UM accounts_payable + installments. Usado pelo handler POST tanto no
 * modo unico quanto no modo split (iterado por split).
 */
async function createOnePayable(args: {
  companyId: string
  supplierId: string | null
  description: string
  notes?: string
  dueDate: string
  categoryId: string | null
  costCenterId: string | null
  totalAmount: number
  paymentMethod?: string
  accountId?: string | null
  installmentCount: number
  groupId?: string | null
}) {
  const { companyId, supplierId, description, notes, dueDate, categoryId,
          costCenterId, totalAmount, paymentMethod, accountId, installmentCount,
          groupId } = args

  const payable = await prisma.accountPayable.create({
    data: {
      company_id: companyId,
      supplier_id: supplierId,
      description,
      notes,
      total_amount: totalAmount,
      due_date: new Date(dueDate),
      category_id: categoryId,
      cost_center_id: costCenterId,
      account_id: accountId || null,
      payment_method: paymentMethod,
      group_id: groupId || null,
      status: 'PENDENTE',
    },
  })

  if (installmentCount > 1) {
    const baseAmount = Math.floor(totalAmount / installmentCount)
    const remainder = totalAmount - baseAmount * installmentCount
    const installments = []
    const baseDate = new Date(dueDate)
    for (let i = 0; i < installmentCount; i++) {
      const d = new Date(baseDate)
      d.setMonth(d.getMonth() + i)
      installments.push({
        company_id: companyId,
        parent_type: 'PAYABLE',
        parent_id: payable.id,
        installment_number: i + 1,
        amount: i === 0 ? baseAmount + remainder : baseAmount,
        due_date: d,
        status: 'PENDENTE',
      })
    }
    await prisma.installment.createMany({ data: installments })
  }

  return payable
}

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = createPayableSchema.parse(body)

    // C15 fix 22/05: valida supplier_id pertence ao tenant (era aceito
    // qualquer UUID, permitindo vazamento de fornecedor cross-tenant em
    // relatorios — mesma classe do incidente customer_id leak 03/05).
    if (data.supplier_id) {
      const supplier = await prisma.customer.findFirst({
        where: { id: data.supplier_id, company_id: user.companyId, deleted_at: null },
        select: { id: true },
      })
      if (!supplier) return error('Fornecedor nao pertence a esta empresa', 403)
    }

    const hasSplits = Array.isArray(data.splits) && data.splits.length > 0

    if (hasSplits) {
      const splits = data.splits!
      const splitsSum = splits.reduce((s, x) => s + x.amount, 0)
      if (splitsSum !== data.total_amount) {
        return error(`Soma dos splits (${splitsSum}) deve ser igual ao total (${data.total_amount})`, 400)
      }

      const groupId = crypto.randomUUID()
      const created = []
      for (let i = 0; i < splits.length; i++) {
        const sp = splits[i]
        const pay = await createOnePayable({
          companyId: user.companyId,
          supplierId: data.supplier_id || null,
          description: splits.length > 1 ? `${data.description} [${i + 1}/${splits.length}]` : data.description,
          notes: data.notes,
          dueDate: data.due_date,
          categoryId: data.category_id || null,
          costCenterId: data.cost_center_id || null,
          totalAmount: sp.amount,
          paymentMethod: sp.payment_method,
          accountId: sp.account_id || null,
          installmentCount: sp.installment_count || 1,
          groupId,
        })
        created.push(pay)
      }

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'financeiro',
        action: 'payable.create_split',
        entityId: groupId,
        newValue: { description: data.description, total_amount: data.total_amount, splits_count: splits.length, group_id: groupId },
      })

      return success({ group_id: groupId, payables: created }, 201)
    }

    // Modo UNICO (retrocompat)
    const payable = await createOnePayable({
      companyId: user.companyId,
      supplierId: data.supplier_id || null,
      description: data.description,
      notes: data.notes,
      dueDate: data.due_date,
      categoryId: data.category_id || null,
      costCenterId: data.cost_center_id || null,
      totalAmount: data.total_amount,
      paymentMethod: data.payment_method,
      accountId: data.account_id || null,
      installmentCount: data.installment_count || 1,
      groupId: null,
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payable.create',
      entityId: payable.id,
      newValue: { description: payable.description, total_amount: payable.total_amount, installments: data.installment_count || 1 },
    })

    return success(payable, 201)
  } catch (err) {
    return handleError(err)
  }
}
