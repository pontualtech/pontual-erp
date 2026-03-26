import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const createReceivableSchema = z.object({
  customer_id: z.string().optional(),
  service_order_id: z.string().optional(),
  description: z.string().min(1),
  notes: z.string().optional(),
  total_amount: z.number().int().positive(),
  due_date: z.string(),
  category_id: z.string().optional(),
  payment_method: z.string().optional(),
})

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)))
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const customerId = searchParams.get('customerId')

    const where: any = { company_id: user.companyId, deleted_at: null }
    if (status) where.status = status
    if (customerId) where.customer_id = customerId
    if (startDate || endDate) {
      where.due_date = {}
      if (startDate) where.due_date.gte = new Date(startDate)
      if (endDate) where.due_date.lte = new Date(endDate)
    }

    const [receivables, total] = await Promise.all([
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
    ])

    return paginated(receivables, total, page, limit)
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

    const receivable = await prisma.accountReceivable.create({
      data: {
        company_id: user.companyId,
        customer_id: data.customer_id,
        service_order_id: data.service_order_id,
        description: data.description,
        notes: data.notes,
        total_amount: data.total_amount,
        due_date: new Date(data.due_date),
        category_id: data.category_id,
        payment_method: data.payment_method,
        status: 'PENDENTE',
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.create',
      entityId: receivable.id,
      newValue: { description: receivable.description, total_amount: receivable.total_amount },
    })

    return success(receivable, 201)
  } catch (err) {
    return handleError(err)
  }
}
