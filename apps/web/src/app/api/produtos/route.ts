import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

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
    const type = searchParams.get('type') // 'produto', 'servico', or null (all)

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
    if (type === 'servico') where.unit = 'SV'
    if (type === 'produto') where.unit = { not: 'SV' }

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

    if (!body.name || !body.name.trim()) return error('Nome é obrigatório', 400)

    const product = await prisma.product.create({
      data: {
        company_id: user.companyId,
        name: body.name.trim(),
        description: body.description || null,
        barcode: body.barcode || null,
        internal_code: body.internal_code || null,
        category_id: body.category_id || null,
        brand: body.brand || null,
        unit: body.unit || 'UN',
        cost_price: Math.round(Number(body.cost_price) || 0),
        sale_price: Math.round(Number(body.sale_price) || 0),
        ncm: body.ncm || null,
        cfop: body.cfop || null,
        min_stock: Number(body.min_stock) || 0,
        max_stock: Number(body.max_stock) || 0,
        photo_url: body.photo_url || null,
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
