import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { paginated, error, handleError } from '@/lib/api-response'

type RouteParams = { params: { id: string } }

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('estoque', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    // Verify product belongs to company
    const product = await prisma.product.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true },
    })
    if (!product) return error('Produto não encontrado', 404)

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 50)))
    const type = searchParams.get('type') // ENTRY, EXIT, ADJUSTMENT

    const where: any = { product_id: params.id, company_id: user.companyId }
    if (type) where.movement_type = type

    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      prisma.stockMovement.count({ where }),
    ])

    return paginated(movements, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}
