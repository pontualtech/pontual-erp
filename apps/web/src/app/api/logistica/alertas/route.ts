import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'

/**
 * GET /api/logistica/alertas?days=7
 *
 * Retorna historico de alertas de inatividade dos motoristas (audit_log
 * com action=driver_inactive_alert) dos ultimos N dias.
 *
 * Permissao: logistics.view (admin/atendente).
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission('logistics', 'view')
  if (auth instanceof NextResponse) return auth

  const days = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get('days') || '7')))
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const alerts = await prisma.auditLog.findMany({
    where: {
      company_id: auth.companyId,
      module: 'logistics',
      action: 'driver_inactive_alert',
      created_at: { gte: cutoff },
    },
    orderBy: { created_at: 'desc' },
    take: 200,
    select: { id: true, entity_id: true, new_value: true, created_at: true },
  })

  return NextResponse.json({
    data: {
      days,
      total: alerts.length,
      alerts: alerts.map(a => {
        const v = a.new_value as any
        return {
          id: a.id,
          driver_id: a.entity_id,
          driver_name: v?.driver_name || 'Desconhecido',
          last_gps_at: v?.last_gps_at,
          minutes_since_last_gps: v?.minutes_since_last_gps,
          alerted_at: a.created_at,
        }
      }),
    },
  })
}
