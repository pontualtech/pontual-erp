import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError, paginated } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const url = new URL(req.url)
    const search = url.searchParams.get('search') || ''
    const equipment_type = url.searchParams.get('equipment_type') || ''
    const brand = url.searchParams.get('brand') || ''
    const model = url.searchParams.get('model') || ''
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)

    const where: any = {
      company_id: user.companyId,
      is_active: true,
    }

    const andClauses: any[] = []

    if (search) {
      andClauses.push({
        OR: [
          { service_description: { contains: search, mode: 'insensitive' } },
          { equipment_type: { contains: search, mode: 'insensitive' } },
          { brand: { contains: search, mode: 'insensitive' } },
          { model_pattern: { contains: search, mode: 'insensitive' } },
        ],
      })
    }

    if (equipment_type) {
      andClauses.push({ equipment_type: { contains: equipment_type, mode: 'insensitive' } })
    }
    if (brand) {
      andClauses.push({ brand: { contains: brand, mode: 'insensitive' } })
    }
    if (model) {
      andClauses.push({ model_pattern: { contains: model, mode: 'insensitive' } })
    }

    if (andClauses.length > 0) {
      where.AND = andClauses
    }

    const [items, total] = await Promise.all([
      prisma.priceTable.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.priceTable.count({ where }),
    ])

    return paginated(items, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()

    const entry = await prisma.priceTable.create({
      data: {
        company_id: user.companyId,
        equipment_type: body.equipment_type || null,
        brand: body.brand || null,
        model_pattern: body.model_pattern || null,
        service_description: body.service_description || null,
        default_price: typeof body.default_price === 'number' ? body.default_price : 0,
        estimated_time_minutes: typeof body.estimated_time_minutes === 'number' ? body.estimated_time_minutes : null,
        is_active: body.is_active !== false,
      },
    })

    return success(entry, 201)
  } catch (err) {
    return handleError(err)
  }
}
