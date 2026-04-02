import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const now = new Date()
    const dateFrom = url.get('dateFrom') || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const dateTo = url.get('dateTo') || now.toISOString().split('T')[0]
    const cid = user.companyId

    // Margin per OS: revenue (total_cost) vs cost (sum of items linked to products with cost_price)
    const margins: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        so.id,
        so.os_number,
        so.equipment_type,
        so.equipment_brand,
        so.equipment_model,
        COALESCE(c.trade_name, c.legal_name, 'Cliente') AS customer_name,
        COALESCE(so.total_cost, 0)::bigint AS revenue_cents,
        COALESCE(costs.total_cost_price, 0)::bigint AS cost_cents,
        COALESCE(so.total_cost, 0) - COALESCE(costs.total_cost_price, 0) AS margin_cents,
        CASE
          WHEN COALESCE(so.total_cost, 0) > 0
          THEN ROUND(((COALESCE(so.total_cost, 0) - COALESCE(costs.total_cost_price, 0))::numeric / so.total_cost) * 100, 1)
          ELSE 0
        END AS margin_percent,
        so.created_at
      FROM service_orders so
      JOIN customers c ON c.id = so.customer_id
      LEFT JOIN (
        SELECT
          soi.service_order_id,
          SUM(
            CASE
              WHEN soi.product_id IS NOT NULL THEN COALESCE(p.cost_price, 0) * soi.quantity
              ELSE 0
            END
          ) AS total_cost_price
        FROM service_order_items soi
        LEFT JOIN products p ON p.id = soi.product_id
        WHERE soi.deleted_at IS NULL
        GROUP BY soi.service_order_id
      ) costs ON costs.service_order_id = so.id
      WHERE so.company_id = $1
        AND so.deleted_at IS NULL
        AND COALESCE(so.total_cost, 0) > 0
        AND so.created_at >= $2::timestamptz
        AND so.created_at <= ($3::date + interval '1 day')::timestamptz
      ORDER BY so.created_at DESC
    `, cid, `${dateFrom}T00:00:00Z`, dateTo)

    const formatted = margins.map(m => ({
      id: m.id,
      osNumber: Number(m.os_number),
      equipmentType: m.equipment_type,
      equipmentBrand: m.equipment_brand,
      equipmentModel: m.equipment_model,
      customerName: m.customer_name,
      revenueCents: Number(m.revenue_cents),
      costCents: Number(m.cost_cents),
      marginCents: Number(m.margin_cents),
      marginPercent: Number(m.margin_percent),
      createdAt: m.created_at,
    }))

    const sorted = [...formatted].sort((a, b) => b.marginCents - a.marginCents)
    const top10Profitable = sorted.slice(0, 10)
    const top10Least = sorted.slice(-10).reverse()

    // Average margin by equipment type
    const byEquipType: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        so.equipment_type,
        COUNT(so.id)::int AS os_count,
        ROUND(AVG(
          CASE
            WHEN COALESCE(so.total_cost, 0) > 0
            THEN ((COALESCE(so.total_cost, 0) - COALESCE(costs.total_cost_price, 0))::numeric / so.total_cost) * 100
            ELSE 0
          END
        ), 1)::float AS avg_margin_percent,
        COALESCE(SUM(so.total_cost), 0)::bigint AS total_revenue_cents,
        COALESCE(SUM(costs.total_cost_price), 0)::bigint AS total_cost_cents
      FROM service_orders so
      LEFT JOIN (
        SELECT
          soi.service_order_id,
          SUM(
            CASE
              WHEN soi.product_id IS NOT NULL THEN COALESCE(p.cost_price, 0) * soi.quantity
              ELSE 0
            END
          ) AS total_cost_price
        FROM service_order_items soi
        LEFT JOIN products p ON p.id = soi.product_id
        WHERE soi.deleted_at IS NULL
        GROUP BY soi.service_order_id
      ) costs ON costs.service_order_id = so.id
      WHERE so.company_id = $1
        AND so.deleted_at IS NULL
        AND COALESCE(so.total_cost, 0) > 0
        AND so.created_at >= $2::timestamptz
        AND so.created_at <= ($3::date + interval '1 day')::timestamptz
      GROUP BY so.equipment_type
      ORDER BY avg_margin_percent DESC
    `, cid, `${dateFrom}T00:00:00Z`, dateTo)

    const totalRevenue = formatted.reduce((s, m) => s + m.revenueCents, 0)
    const totalCost = formatted.reduce((s, m) => s + m.costCents, 0)
    const avgMargin = totalRevenue > 0
      ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 10000) / 100
      : 0

    return success({
      summary: {
        totalOs: formatted.length,
        totalRevenueCents: totalRevenue,
        totalCostCents: totalCost,
        avgMarginPercent: avgMargin,
      },
      top10Profitable,
      top10Least,
      byEquipmentType: byEquipType.map(e => ({
        equipmentType: e.equipment_type,
        osCount: Number(e.os_count),
        avgMarginPercent: Number(e.avg_margin_percent),
        totalRevenueCents: Number(e.total_revenue_cents),
        totalCostCents: Number(e.total_cost_cents),
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}
