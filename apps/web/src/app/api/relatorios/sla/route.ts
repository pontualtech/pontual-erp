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

    // Average time per status transition (hours)
    const avgTimePerStatus: any[] = await prisma.$queryRawUnsafe(`
      WITH transitions AS (
        SELECT
          soh.id,
          soh.to_status_id,
          soh.service_order_id,
          soh.created_at,
          LEAD(soh.created_at) OVER (PARTITION BY soh.service_order_id ORDER BY soh.created_at) AS next_at
        FROM service_order_history soh
        JOIN service_orders so ON so.id = soh.service_order_id
        WHERE soh.company_id = $1
          AND so.deleted_at IS NULL
          AND so.created_at >= $2::timestamptz
          AND so.created_at <= ($3::date + interval '1 day')::timestamptz
      )
      SELECT
        ms.name AS status_name,
        ms.color,
        ms.order AS status_order,
        COUNT(t.id)::int AS transition_count,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (COALESCE(t.next_at, NOW()) - t.created_at)) / 3600
        ), 1)::float AS avg_hours
      FROM transitions t
      JOIN module_statuses ms ON ms.id = t.to_status_id
      GROUP BY ms.name, ms.color, ms.order
      ORDER BY ms.order ASC
    `, cid, `${dateFrom}T00:00:00Z`, dateTo)

    // SLA compliance: <48h for diagnostic (2nd status), <10d (240h) for total repair
    const slaData: any[] = await prisma.$queryRawUnsafe(`
      WITH os_times AS (
        SELECT
          so.id,
          so.os_number,
          so.equipment_type,
          so.created_at,
          so.updated_at,
          EXTRACT(EPOCH FROM (so.updated_at - so.created_at)) / 3600 AS total_hours,
          ms.is_final
        FROM service_orders so
        JOIN module_statuses ms ON ms.id = so.status_id
        WHERE so.company_id = $1
          AND so.deleted_at IS NULL
          AND so.created_at >= $2::timestamptz
          AND so.created_at <= ($3::date + interval '1 day')::timestamptz
      )
      SELECT
        COUNT(*)::int AS total_os,
        COUNT(CASE WHEN is_final = true AND total_hours <= 240 THEN 1 END)::int AS within_sla_repair,
        COUNT(CASE WHEN is_final = true THEN 1 END)::int AS total_completed,
        COUNT(CASE WHEN is_final = false AND total_hours > 240 THEN 1 END)::int AS overdue_count
      FROM os_times
    `, cid, `${dateFrom}T00:00:00Z`, dateTo)

    // Overdue OS list (open and >10 days old)
    const overdueList: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        so.id,
        so.os_number,
        so.equipment_type,
        so.equipment_brand,
        so.equipment_model,
        c.name AS customer_name,
        up.name AS technician_name,
        ms.name AS status_name,
        ms.color AS status_color,
        so.created_at,
        ROUND(EXTRACT(EPOCH FROM (NOW() - so.created_at)) / 3600, 1)::float AS hours_open
      FROM service_orders so
      JOIN customers c ON c.id = so.customer_id
      JOIN module_statuses ms ON ms.id = so.status_id
      LEFT JOIN user_profiles up ON up.id = so.technician_id
      WHERE so.company_id = $1
        AND so.deleted_at IS NULL
        AND ms.is_final = false
        AND EXTRACT(EPOCH FROM (NOW() - so.created_at)) / 3600 > 240
        AND so.created_at >= $2::timestamptz
        AND so.created_at <= ($3::date + interval '1 day')::timestamptz
      ORDER BY so.created_at ASC
      LIMIT 50
    `, cid, `${dateFrom}T00:00:00Z`, dateTo)

    const sla = slaData[0] || { total_os: 0, within_sla_repair: 0, total_completed: 0, overdue_count: 0 }
    const slaRepairPercent = sla.total_completed > 0
      ? Math.round((Number(sla.within_sla_repair) / Number(sla.total_completed)) * 10000) / 100
      : 0

    return success({
      statusTimes: avgTimePerStatus.map(s => ({
        statusName: s.status_name,
        color: s.color,
        avgHours: Number(s.avg_hours) || 0,
        transitionCount: Number(s.transition_count),
      })),
      sla: {
        totalOs: Number(sla.total_os),
        totalCompleted: Number(sla.total_completed),
        withinSlaRepair: Number(sla.within_sla_repair),
        slaRepairPercent,
        overdueCount: Number(sla.overdue_count),
      },
      overdueList: overdueList.map(o => ({
        id: o.id,
        osNumber: o.os_number,
        equipmentType: o.equipment_type,
        equipmentBrand: o.equipment_brand,
        equipmentModel: o.equipment_model,
        customerName: o.customer_name,
        technicianName: o.technician_name,
        statusName: o.status_name,
        statusColor: o.status_color,
        createdAt: o.created_at,
        hoursOpen: Number(o.hours_open),
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}
