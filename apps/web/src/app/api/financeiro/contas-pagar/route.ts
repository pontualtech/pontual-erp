import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const createPayableSchema = z.object({
  supplier_id: z.string().optional(),
  description: z.string().min(1),
  notes: z.string().optional(),
  total_amount: z.number().int().positive(),
  due_date: z.string(),
  category_id: z.string().optional(),
  cost_center_id: z.string().optional(),
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
    const supplierId = searchParams.get('supplierId')

    const where: any = { company_id: user.companyId, deleted_at: null }
    if (status) where.status = status
    if (supplierId) where.supplier_id = supplierId
    if (startDate || endDate) {
      where.due_date = {}
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

    return paginated(payables, total, page, limit)
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

    const payable = await prisma.accountPayable.create({
      data: {
        company_id: user.companyId,
        supplier_id: data.supplier_id,
        description: data.description,
        notes: data.notes,
        total_amount: data.total_amount,
        due_date: new Date(data.due_date),
        category_id: data.category_id,
        cost_center_id: data.cost_center_id,
        payment_method: data.payment_method,
        status: 'PENDENTE',
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payable.create',
      entityId: payable.id,
      newValue: { description: payable.description, total_amount: payable.total_amount },
    })

    return success(payable, 201)
  } catch (err) {
    return handleError(err)
  }
}
