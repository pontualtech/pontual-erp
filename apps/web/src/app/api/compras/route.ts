import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const purchaseItemSchema = z.object({
  product_id: z.string(),
  quantity: z.number().positive(),
  unit_cost: z.number().int().min(0),
})

const createPurchaseSchema = z.object({
  supplier_id: z.string(),
  invoice_ref: z.string().optional(),
  shipping_cost: z.number().int().min(0).default(0),
  discount: z.number().int().min(0).default(0),
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

    const where: any = { company_id: user.companyId }
    if (status) where.status = status

    const [entries, total] = await Promise.all([
      prisma.purchaseEntry.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          customers: { select: { id: true, legal_name: true } },
          _count: { select: { purchase_entry_items: true } },
        },
      }),
      prisma.purchaseEntry.count({ where }),
    ])

    return paginated(entries, total, page, limit)
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

    // Calculate totals
    const totalItems = data.items.reduce(
      (sum, i) => sum + (i.unit_cost * i.quantity), 0
    )
    const total_cost = totalItems + data.shipping_cost - data.discount

    // Get next entry number
    const lastEntry = await prisma.purchaseEntry.findFirst({
      where: { company_id: user.companyId },
      orderBy: { entry_number: 'desc' },
      select: { entry_number: true },
    })
    const entry_number = (lastEntry?.entry_number ?? 0) + 1

    const entry = await prisma.purchaseEntry.create({
      data: {
        company_id: user.companyId,
        entry_number,
        supplier_id: data.supplier_id,
        invoice_ref: data.invoice_ref,
        shipping_cost: data.shipping_cost,
        discount: data.discount,
        total_cost,
        notes: data.notes,
        status: 'RECEBIDA',
        purchase_entry_items: {
          create: data.items.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            unit_cost: item.unit_cost,
            total_cost: item.unit_cost * item.quantity,
          })),
        },
      },
      include: { purchase_entry_items: true },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'compras',
      action: 'purchase.create',
      entityId: entry.id,
      newValue: { entry_number, total_cost, itemCount: data.items.length },
    })

    return success(entry, 201)
  } catch (err) {
    return handleError(err)
  }
}
