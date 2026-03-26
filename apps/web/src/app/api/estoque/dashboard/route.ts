import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(_request: NextRequest) {
  try {
    const result = await requirePermission('estoque', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const baseWhere = { company_id: user.companyId, deleted_at: null, is_active: true }

    const [
      totalProducts,
      outOfStock,
      allWithMin,
      recentMovements,
    ] = await Promise.all([
      prisma.product.count({ where: baseWhere }),

      prisma.product.count({
        where: { ...baseWhere, current_stock: { lte: 0 } },
      }),

      prisma.product.findMany({
        where: { ...baseWhere, min_stock: { not: null } },
        select: { current_stock: true, min_stock: true },
      }),

      prisma.stockMovement.count({
        where: {
          company_id: user.companyId,
          created_at: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ])

    const belowMin = allWithMin.filter(
      p => p.min_stock !== null && p.min_stock !== undefined && (p.current_stock ?? 0) <= p.min_stock
    ).length

    // Stock value: sum of (current_stock * cost_price)
    const [stockValue] = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(CAST(current_stock AS numeric) * cost_price), 0)::bigint as total
      FROM products
      WHERE company_id = ${user.companyId}
        AND deleted_at IS NULL
        AND is_active = true
    `

    return success({
      totalProducts,
      stockValueCents: Number(stockValue?.total ?? 0),
      outOfStock,
      belowMin,
      movementsLast30Days: recentMovements,
    })
  } catch (err) {
    return handleError(err)
  }
}
