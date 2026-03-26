import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, handleError } from '@/lib/api-response'

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('estoque', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 50)))

    // Products below minimum stock
    const belowMinWhere = {
      company_id: user.companyId,
      deleted_at: null,
      is_active: true,
      min_stock: { not: null },
    }

    const products = await prisma.product.findMany({
      where: belowMinWhere,
      select: {
        id: true,
        name: true,
        internal_code: true,
        current_stock: true,
        min_stock: true,
        max_stock: true,
        unit: true,
        category_id: true,
        categories: { select: { id: true, name: true } },
      },
      orderBy: { current_stock: 'asc' },
    })

    // Filter in application: Prisma cannot compare two columns directly
    const alerts = products
      .filter(p => p.min_stock !== null && p.min_stock !== undefined && (p.current_stock ?? 0) <= p.min_stock)
      .map(p => ({
        ...p,
        alertType: (p.current_stock ?? 0) === 0 ? 'OUT_OF_STOCK' : 'BELOW_MIN',
        deficit: (p.min_stock ?? 0) - (p.current_stock ?? 0),
      }))

    const total = alerts.length
    const paged = alerts.slice((page - 1) * limit, page * limit)

    return paginated(paged, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}
