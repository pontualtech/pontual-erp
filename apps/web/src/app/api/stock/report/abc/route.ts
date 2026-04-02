import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('estoque', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const months = Math.min(24, Math.max(1, Number(searchParams.get('months') || 12)))
    const since = new Date()
    since.setMonth(since.getMonth() - months)

    // Get all EXIT movements (sales) with product info
    const movements = await prisma.stockMovement.findMany({
      where: {
        company_id: user.companyId,
        movement_type: 'EXIT',
        created_at: { gte: since },
      },
      select: {
        product_id: true,
        quantity: true,
        products: {
          select: { id: true, name: true, sale_price: true, current_stock: true, category_id: true },
        },
      },
    })

    // Aggregate revenue per product
    const revenueMap = new Map<string, {
      product_id: string
      name: string
      sale_price: number
      current_stock: number
      total_qty: number
      revenue: number
    }>()

    for (const m of movements) {
      if (!m.products) continue
      const existing = revenueMap.get(m.product_id) || {
        product_id: m.product_id,
        name: m.products.name,
        sale_price: m.products.sale_price ?? 0,
        current_stock: m.products.current_stock ?? 0,
        total_qty: 0,
        revenue: 0,
      }
      existing.total_qty += m.quantity
      existing.revenue += m.quantity * (m.products.sale_price ?? 0)
      revenueMap.set(m.product_id, existing)
    }

    // Sort by revenue descending
    const sorted = Array.from(revenueMap.values()).sort((a, b) => b.revenue - a.revenue)
    const totalRevenue = sorted.reduce((sum, p) => sum + p.revenue, 0)

    // Classify A / B / C
    let cumulative = 0
    const classified = sorted.map((item) => {
      cumulative += item.revenue
      const pctCumulative = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 0
      let curve: 'A' | 'B' | 'C'
      if (pctCumulative <= 80) curve = 'A'
      else if (pctCumulative <= 95) curve = 'B'
      else curve = 'C'

      return {
        ...item,
        pct: totalRevenue > 0 ? Math.round((item.revenue / totalRevenue) * 10000) / 100 : 0,
        pct_cumulative: Math.round(pctCumulative * 100) / 100,
        curve,
      }
    })

    const summary = {
      total_revenue: totalRevenue,
      months,
      total_products: classified.length,
      a_count: classified.filter(p => p.curve === 'A').length,
      b_count: classified.filter(p => p.curve === 'B').length,
      c_count: classified.filter(p => p.curve === 'C').length,
    }

    return success({ summary, products: classified })
  } catch (err) {
    return handleError(err)
  }
}
