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
    const commissionPercent = Number(url.get('commissionPercent') || '10')
    const cid = user.companyId

    // Get final statuses
    const finalStatuses = await prisma.moduleStatus.findMany({
      where: { company_id: cid, module: 'os', is_final: true },
      select: { id: true },
    })
    const finalIds = finalStatuses.map(s => `'${s.id}'`).join(',')

    if (!finalIds) {
      return success({ technicians: [], summary: { totalOs: 0, totalRevenueCents: 0, totalCommissionCents: 0 }, commissionPercent })
    }

    const technicians: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        so.technician_id,
        up.name AS technician_name,
        COUNT(so.id)::int AS os_count,
        COALESCE(SUM(so.total_cost), 0)::bigint AS total_revenue_cents
      FROM service_orders so
      JOIN user_profiles up ON up.id = so.technician_id
      WHERE so.company_id = $1
        AND so.deleted_at IS NULL
        AND so.technician_id IS NOT NULL
        AND so.status_id IN (${finalIds})
        AND so.updated_at >= $2::timestamptz
        AND so.updated_at <= ($3::date + interval '1 day')::timestamptz
      GROUP BY so.technician_id, up.name
      ORDER BY total_revenue_cents DESC
    `, cid, `${dateFrom}T00:00:00Z`, dateTo)

    const formatted = technicians.map(t => {
      const revenue = Number(t.total_revenue_cents)
      const commission = Math.round(revenue * commissionPercent / 100)
      return {
        technicianId: t.technician_id,
        technicianName: t.technician_name,
        osCount: Number(t.os_count),
        revenueCents: revenue,
        commissionPercent,
        commissionCents: commission,
      }
    })

    return success({
      technicians: formatted,
      summary: {
        totalOs: formatted.reduce((s, t) => s + t.osCount, 0),
        totalRevenueCents: formatted.reduce((s, t) => s + t.revenueCents, 0),
        totalCommissionCents: formatted.reduce((s, t) => s + t.commissionCents, 0),
      },
      commissionPercent,
    })
  } catch (err) {
    return handleError(err)
  }
}
