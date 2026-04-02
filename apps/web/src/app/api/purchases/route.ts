import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const purchaseItemSchema = z.object({
  product_id: z.string().optional(),
  description: z.string().optional(),
  quantity: z.number().int().positive(),
  unit_cost: z.number().int().min(0),
})

const createPurchaseSchema = z.object({
  supplier_id: z.string(),
  number: z.string().optional(),
  nfe_key: z.string().optional(),
  expected_delivery: z.string().optional(), // ISO date string
  notes: z.string().optional(),
  items: z.array(purchaseItemSchema).min(1),
})

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('compras', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)))
    const status = searchParams.get('status')
    const supplier_id = searchParams.get('supplier_id')
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const where: any = { company_id: user.companyId }
    if (status) where.status = status
    if (supplier_id) where.supplier_id = supplier_id
    if (from || to) {
      where.created_at = {}
      if (from) where.created_at.gte = new Date(from)
      if (to) where.created_at.lte = new Date(to)
    }

    const [purchases, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          suppliers: { select: { id: true, name: true } },
          _count: { select: { purchase_items: true } },
        },
      }),
      prisma.purchase.count({ where }),
    ])

    return paginated(purchases, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('compras', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = createPurchaseSchema.parse(body)

    // Verify supplier belongs to company
    const supplier = await prisma.supplier.findFirst({
      where: { id: data.supplier_id, company_id: user.companyId },
    })
    if (!supplier) return error('Fornecedor não encontrado', 404)

    // Calculate total
    const total = data.items.reduce(
      (sum, item) => sum + item.unit_cost * item.quantity, 0
    )

    const purchase = await prisma.purchase.create({
      data: {
        company_id: user.companyId,
        supplier_id: data.supplier_id,
        number: data.number || null,
        nfe_key: data.nfe_key || null,
        expected_delivery: data.expected_delivery ? new Date(data.expected_delivery) : null,
        notes: data.notes || null,
        total,
        status: 'DRAFT',
        created_by: user.id,
        purchase_items: {
          create: data.items.map((item) => ({
            product_id: item.product_id || null,
            description: item.description || null,
            quantity: item.quantity,
            unit_cost: item.unit_cost,
            total: item.unit_cost * item.quantity,
          })),
        },
      },
      include: { purchase_items: true, suppliers: { select: { id: true, name: true } } },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'compras',
      action: 'purchase.create',
      entityId: purchase.id,
      newValue: { supplier: supplier.name, total, itemCount: data.items.length },
    })

    return success(purchase, 201)
  } catch (err) {
    return handleError(err)
  }
}
