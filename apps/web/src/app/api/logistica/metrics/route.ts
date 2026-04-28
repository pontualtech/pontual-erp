import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'

/**
 * GET /api/logistica/metrics?days=30
 *
 * KPIs agregados do modulo logistica nos ultimos N dias.
 *
 * Retorna:
 *  - total_routes / total_stops nos N dias
 *  - completion_rate (%)
 *  - avg_minutes_per_stop (entre arrived_at e completed_at)
 *  - postponed_count + postponed_pct (paradas adiadas)
 *  - failed_count + failed_pct
 *  - by_driver: top 5 motoristas por # paradas concluidas
 *
 * Permissao: logistics.view.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission('logistics', 'view')
  if (auth instanceof NextResponse) return auth

  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get('days') || '30')))
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  cutoff.setHours(0, 0, 0, 0)

  // Rotas no periodo
  const routes = await prisma.logisticsRoute.findMany({
    where: { company_id: auth.companyId, date: { gte: cutoff } },
    select: { id: true, driver_id: true, status: true, total_stops: true, completed_stops: true, driver: { select: { name: true } } },
  })

  // Stops das rotas no periodo (com timing pra calcular tempo medio)
  const routeIds = routes.map(r => r.id)
  const stops = routeIds.length === 0 ? [] : await prisma.logisticsStop.findMany({
    where: { route_id: { in: routeIds } },
    select: { status: true, arrived_at: true, completed_at: true, visit_reschedule_at: true },
  })

  const totalRoutes = routes.length
  const totalStops = stops.length
  const completed = stops.filter(s => s.status === 'COMPLETED')
  const failed = stops.filter(s => s.status === 'FAILED')
  const postponed = stops.filter(s => s.visit_reschedule_at !== null)

  // Tempo medio por parada: entre arrived_at e completed_at, pra paradas
  // que tem AMBOS (alguns motoristas pulam o "registrar chegada" no campo)
  const timed = completed
    .filter(s => s.arrived_at && s.completed_at)
    .map(s => (s.completed_at!.getTime() - s.arrived_at!.getTime()) / 1000 / 60) // minutos

  const avgMinutesPerStop = timed.length > 0
    ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length)
    : null

  // Top 5 motoristas por paradas concluidas
  const byDriverMap = new Map<string, { name: string; routes: number; completed: number; total: number }>()
  for (const r of routes) {
    if (!r.driver_id) continue
    const cur = byDriverMap.get(r.driver_id) || { name: r.driver?.name || 'Sem nome', routes: 0, completed: 0, total: 0 }
    cur.routes += 1
    cur.completed += r.completed_stops || 0
    cur.total += r.total_stops || 0
    byDriverMap.set(r.driver_id, cur)
  }
  const byDriver = [...byDriverMap.values()]
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 5)
    .map(d => ({
      ...d,
      completion_rate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0,
    }))

  return NextResponse.json({
    data: {
      period_days: days,
      since: cutoff.toISOString(),
      totals: {
        routes: totalRoutes,
        stops: totalStops,
        completed: completed.length,
        failed: failed.length,
        postponed: postponed.length,
      },
      rates: {
        completion_pct: totalStops > 0 ? Math.round((completed.length / totalStops) * 100) : 0,
        failed_pct: totalStops > 0 ? Math.round((failed.length / totalStops) * 100) : 0,
        postponed_pct: totalStops > 0 ? Math.round((postponed.length / totalStops) * 100) : 0,
      },
      timing: {
        avg_minutes_per_stop: avgMinutesPerStop,
        sample_size: timed.length,
      },
      top_drivers: byDriver,
    },
  })
}
