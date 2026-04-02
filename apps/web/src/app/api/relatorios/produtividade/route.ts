import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const now = new Date()
    const dateFrom = url.get('dateFrom') || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const dateTo = url.get('dateTo') || now.toISOString().split('T')[0]
    const cid = user.companyId

    // Get final statuses (completed)
    const finalStatuses = await prisma.moduleStatus.findMany({
      where: { company_id: cid, module: 'os', is_final: true },
      select: { id: true },
    })
    const finalIds = finalStatuses.map(s => `'${s.id}'`).join(',')

    if (!finalIds) {
      return success({ technicians: [], summary: { totalCompleted: 0, avgRepairHours: 0, totalRevenue: 0 } })
    }

    // Per-technician productivity with raw SQL
    const technicians: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        so.technician_id,
        up.name AS technician_name,
        COUNT(so.id)::int AS total_completed,
        ROUND(AVG(EXTRACT(EPOCH FROM (so.updated_at - so.created_at)) / 3600), 1)::float AS avg_repair_hours,
        COALESCE(SUM(so.total_cost), 0)::bigint AS revenue_cents,
        COUNT(CASE WHEN so.is_warranty = true THEN 1 END)::int AS rework_count
      FROM service_orders so
      JOIN user_profiles up ON up.id = so.technician_id
      WHERE so.company_id = $1
        AND so.deleted_at IS NULL
        AND so.technician_id IS NOT NULL
        AND so.status_id IN (${finalIds})
        AND so.updated_at >= $2::timestamptz
        AND so.updated_at <= ($3::date + interval '1 day')::timestamptz
      GROUP BY so.technician_id, up.name
      ORDER BY total_completed DESC
    `, cid, `${dateFrom}T00:00:00Z`, dateTo)

    const formatted = technicians.map(t => ({
      technicianId: t.technician_id,
      technicianName: t.technician_name,
      totalCompleted: Number(t.total_completed),
      avgRepairHours: Number(t.avg_repair_hours) || 0,
      revenueCents: Number(t.revenue_cents),
      reworkCount: Number(t.rework_count),
      reworkPercent: t.total_completed > 0
        ? Math.round((Number(t.rework_count) / Number(t.total_completed)) * 10000) / 100
        : 0,
    }))

    const summary = {
      totalCompleted: formatted.reduce((s, t) => s + t.totalCompleted, 0),
      avgRepairHours: formatted.length > 0
        ? Math.round((formatted.reduce((s, t) => s + t.avgRepairHours, 0) / formatted.length) * 10) / 10
        : 0,
      totalRevenueCents: formatted.reduce((s, t) => s + t.revenueCents, 0),
    }

    return success({ technicians: formatted, summary })
  } catch (err) {
    return handleError(err)
  }
}
