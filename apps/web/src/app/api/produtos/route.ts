import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  barcode: z.string().optional(),
  internal_code: z.string().optional(),
  category_id: z.string().optional(),
  brand: z.string().optional(),
  unit: z.string().default('UN'),
  cost_price: z.number().int().min(0).default(0),
  sale_price: z.number().int().min(0).default(0),
  ncm: z.string().optional(),
  cfop: z.string().optional(),
  min_stock: z.number().optional(),
  max_stock: z.number().optional(),
  photo_url: z.string().optional(),
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
    const categoryId = searchParams.get('categoryId')
    const isActive = searchParams.get('isActive') !== 'false'

    const where: any = {
      company_id: user.companyId,
      deleted_at: null,
      is_active: isActive,
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        { internal_code: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (categoryId) where.category_id = categoryId

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
        include: { categories: { select: { id: true, name: true } } },
      }),
      prisma.product.count({ where }),
    ])

    return paginated(products, total, page, limit)
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
    const data = createProductSchema.parse(body)

    const product = await prisma.product.create({
      data: {
        ...data,
        company_id: user.companyId,
        current_stock: 0,
        reserved_stock: 0,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'estoque',
      action: 'product.create',
      entityId: product.id,
      newValue: { name: product.name, sale_price: product.sale_price },
    })

    return success(product, 201)
  } catch (err) {
    return handleError(err)
  }
}
