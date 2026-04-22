import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/logistics/metrics
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&driver_id=...
 * Default period: ultimos 30 dias.
 *
 * Devolve metricas agregadas do historico de rotas para dashboard:
 *  - totais (rotas, stops, completion rate)
 *  - por motorista (rotas, stops, taxa de sucesso, tempo medio)
 *  - motivos de falha (top 10)
 *  - tendencia diaria (array {date, completed, failed}) pra grafico
 *
 * Tudo escopado por company_id via requirePermission.
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const driverId = url.get('driver_id')

    const now = new Date()
    const defaultFrom = new Date(now)
    defaultFrom.setDate(defaultFrom.getDate() - 30)

    const fromStr = url.get('from')
    const toStr = url.get('to')
    const from = fromStr ? new Date(fromStr + 'T00:00:00') : defaultFrom
    const to = toStr ? new Date(toStr + 'T23:59:59') : now

    const routeWhere: any = {
      company_id: user.companyId,
      date: { gte: from, lte: to },
    }
    if (driverId) routeWhere.driver_id = driverId

    const stopWhere: any = {
      company_id: user.companyId,
      route: { date: { gte: from, lte: to }, ...(driverId ? { driver_id: driverId } : {}) },
    }

    // --- Totais gerais (queries paralelas) ---
    const [routeStats, totalStops, completedStops, failedStops] = await Promise.all([
      prisma.logisticsRoute.groupBy({
        by: ['status'],
        where: routeWhere,
        _count: { _all: true },
      }),
      prisma.logisticsStop.count({ where: stopWhere }),
      prisma.logisticsStop.count({ where: { ...stopWhere, status: 'COMPLETED' } }),
      prisma.logisticsStop.count({ where: { ...stopWhere, status: 'FAILED' } }),
    ])

    const totalRoutes = routeStats.reduce((sum, g) => sum + g._count._all, 0)
    const completedRoutes = routeStats.find(g => g.status === 'COMPLETED')?._count._all ?? 0
    const inProgressRoutes = routeStats.find(g => g.status === 'IN_PROGRESS')?._count._all ?? 0
    const plannedRoutes = routeStats.find(g => g.status === 'PLANNED')?._count._all ?? 0
    const successRate = totalStops > 0 ? Math.round((completedStops / totalStops) * 100) : 0

    // --- Por motorista: rotas, stops, tempo medio ---
    // groupBy nao suporta relations, entao busca os stops enriquecidos
    // e agrega em memoria. Razoavel ate ~10k stops no periodo.
    const stopsForAgg = await prisma.logisticsStop.findMany({
      where: stopWhere,
      select: {
        status: true,
        arrived_at: true,
        completed_at: true,
        failure_reason: true,
        route: { select: { driver_id: true, driver: { select: { id: true, name: true } } } },
      },
    })

    const byDriverMap = new Map<string, { id: string; name: string; total: number; completed: number; failed: number; totalDurationMs: number; durationSamples: number }>()
    for (const s of stopsForAgg) {
      const d = s.route?.driver
      if (!d) continue
      const k = d.id
      const cur = byDriverMap.get(k) || { id: d.id, name: d.name, total: 0, completed: 0, failed: 0, totalDurationMs: 0, durationSamples: 0 }
      cur.total += 1
      if (s.status === 'COMPLETED') cur.completed += 1
      if (s.status === 'FAILED') cur.failed += 1
      if (s.arrived_at && s.completed_at) {
        cur.totalDurationMs += (s.completed_at.getTime() - s.arrived_at.getTime())
        cur.durationSamples += 1
      }
      byDriverMap.set(k, cur)
    }
    const byDriver = Array.from(byDriverMap.values())
      .map(d => ({
        driver_id: d.id,
        driver_name: d.name,
        total_stops: d.total,
        completed_stops: d.completed,
        failed_stops: d.failed,
        success_rate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0,
        avg_minutes_per_stop: d.durationSamples > 0 ? Math.round(d.totalDurationMs / d.durationSamples / 60000) : null,
      }))
      .sort((a, b) => b.total_stops - a.total_stops)

    // --- Motivos de falha (top 10) ---
    const failureReasons = stopsForAgg
      .filter(s => s.status === 'FAILED' && s.failure_reason)
      .reduce<Record<string, number>>((acc, s) => {
        const reason = (s.failure_reason || '').trim().slice(0, 80) || 'Sem motivo'
        acc[reason] = (acc[reason] || 0) + 1
        return acc
      }, {})
    const topFailures = Object.entries(failureReasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // --- Tendencia diaria (stops por dia) ---
    const trendMap = new Map<string, { date: string; completed: number; failed: number }>()
    for (const s of stopsForAgg) {
      if (!s.completed_at) continue
      const d = s.completed_at.toISOString().slice(0, 10)
      const cur = trendMap.get(d) || { date: d, completed: 0, failed: 0 }
      if (s.status === 'COMPLETED') cur.completed += 1
      if (s.status === 'FAILED') cur.failed += 1
      trendMap.set(d, cur)
    }
    const trend = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    return success({
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      totals: {
        total_routes: totalRoutes,
        completed_routes: completedRoutes,
        in_progress_routes: inProgressRoutes,
        planned_routes: plannedRoutes,
        total_stops: totalStops,
        completed_stops: completedStops,
        failed_stops: failedStops,
        success_rate: successRate,
      },
      by_driver: byDriver,
      top_failures: topFailures,
      trend,
    })
  } catch (err) {
    return handleError(err)
  }
}
