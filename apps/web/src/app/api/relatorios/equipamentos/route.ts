import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/relatorios/equipamentos
 *
 * Sprint UX-17 (audit 2026-05-23) — M3 Relatório receita por equipamento.
 * Inspirado em NetSuite Item Profitability + SAP.
 *
 * Karlão: "Quais marcas/modelos mais geram receita? Onde concentra retrabalho?"
 *
 * Agrupa OS por equipment_brand + equipment_model. Retorna 4 dimensões:
 *  - Receita aprovada (SUM total_cost de OS finalizadas)
 *  - Volume (COUNT OS)
 *  - Ticket médio
 *  - Taxa de garantia (% de OS com is_warranty=true sobre total daquela marca/modelo)
 *
 * Filtros: dateFrom, dateTo (default mês corrente).
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const now = new Date()
    const dateFrom = url.get('dateFrom') || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const dateTo = url.get('dateTo') || now.toISOString().split('T')[0]

    // Top equipamentos por receita — limita 50 pra UI ficar rápida
    const rows: Array<{
      equipment_brand: string | null
      equipment_model: string | null
      equipment_type: string | null
      os_count: bigint
      total_revenue_cents: bigint
      warranty_count: bigint
      avg_total_cost_cents: number | null
    }> = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(NULLIF(TRIM(equipment_brand), ''), 'Sem marca') AS equipment_brand,
        COALESCE(NULLIF(TRIM(equipment_model), ''), 'Sem modelo') AS equipment_model,
        COALESCE(NULLIF(TRIM(equipment_type), ''), 'Não informado') AS equipment_type,
        COUNT(*)::bigint AS os_count,
        COALESCE(SUM(total_cost), 0)::bigint AS total_revenue_cents,
        COUNT(*) FILTER (WHERE is_warranty = TRUE)::bigint AS warranty_count,
        ROUND(AVG(NULLIF(total_cost, 0))) AS avg_total_cost_cents
      FROM service_orders
      WHERE company_id = $1
        AND deleted_at IS NULL
        AND created_at >= $2::timestamptz
        AND created_at <= ($3::date + INTERVAL '1 day')::timestamptz
      GROUP BY 1, 2, 3
      ORDER BY total_revenue_cents DESC, os_count DESC
      LIMIT 50
    `, user.companyId, dateFrom, dateTo)

    const items = rows.map(r => {
      const osCount = Number(r.os_count)
      const warrantyCount = Number(r.warranty_count)
      return {
        equipment_brand: r.equipment_brand,
        equipment_model: r.equipment_model,
        equipment_type: r.equipment_type,
        os_count: osCount,
        total_revenue_cents: Number(r.total_revenue_cents),
        avg_total_cost_cents: r.avg_total_cost_cents != null ? Number(r.avg_total_cost_cents) : 0,
        warranty_count: warrantyCount,
        warranty_rate_pct: osCount > 0 ? Math.round((warrantyCount / osCount) * 1000) / 10 : 0,
      }
    })

    const totals = {
      os_count: items.reduce((a, i) => a + i.os_count, 0),
      total_revenue_cents: items.reduce((a, i) => a + i.total_revenue_cents, 0),
      warranty_count: items.reduce((a, i) => a + i.warranty_count, 0),
      distinct_models: items.length,
    }

    return success({ items, totals, dateFrom, dateTo })
  } catch (err) {
    return handleError(err)
  }
}
