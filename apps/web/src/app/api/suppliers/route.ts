import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const createSupplierSchema = z.object({
  name: z.string().min(1),
  document: z.string().optional(),
  contact_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  avg_delivery_days: z.number().int().positive().optional(),
  notes: z.string().optional(),
})

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('estoque', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)))
    const search = searchParams.get('search') || ''
    const active = searchParams.get('active')

    const where: any = { company_id: user.companyId }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { document: { contains: search, mode: 'insensitive' } },
        { contact_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (active === 'true') where.is_active = true
    if (active === 'false') where.is_active = false

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { purchases: true } },
        },
      }),
      prisma.supplier.count({ where }),
    ])

    return paginated(suppliers, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('estoque', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = createSupplierSchema.parse(body)

    const supplier = await prisma.supplier.create({
      data: {
        company_id: user.companyId,
        name: data.name.trim(),
        document: data.document || null,
        contact_name: data.contact_name || null,
        phone: data.phone || null,
        email: data.email || null,
        avg_delivery_days: data.avg_delivery_days ?? null,
        notes: data.notes || null,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'estoque',
      action: 'supplier.create',
      entityId: supplier.id,
      newValue: { name: supplier.name },
    })

    return success(supplier, 201)
  } catch (err) {
    return handleError(err)
  }
}
