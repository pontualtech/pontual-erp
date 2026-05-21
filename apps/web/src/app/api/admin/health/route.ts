import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/admin/health — série temporal de snapshots /api/health.
 *
 * Query params:
 *   range: '1h' | '24h' | '7d' (default '24h')
 *   limit: max rows (default 300, max 2000)
 *
 * Retorna também KPIs derivados: uptime%, último status, snapshots críticos.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireSuperAdmin()
    if (guard instanceof NextResponse) return guard

    const { searchParams } = new URL(req.url)
    const range = (searchParams.get('range') || '24h') as '1h' | '24h' | '7d'
    const limit = Math.min(Number(searchParams.get('limit')) || 300, 2000)

    const hoursByRange: Record<string, number> = { '1h': 1, '24h': 24, '7d': 24 * 7 }
    const hours = hoursByRange[range] ?? 24
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)

    const [snapshots, totalInRange, criticalInRange, latest] = await Promise.all([
      prisma.healthSnapshot.findMany({
        where: { snapshot_at: { gte: since } },
        orderBy: { snapshot_at: 'desc' },
        take: limit,
      }),
      prisma.healthSnapshot.count({ where: { snapshot_at: { gte: since } } }),
      prisma.healthSnapshot.count({
        where: { snapshot_at: { gte: since }, status: { not: 'ok' } },
      }),
      prisma.healthSnapshot.findFirst({ orderBy: { snapshot_at: 'desc' } }),
    ])

    const uptime_pct = totalInRange > 0
      ? Number((((totalInRange - criticalInRange) / totalInRange) * 100).toFixed(2))
      : null

    // Ordena ascendente pro gráfico (recharts plota left-to-right)
    const seriesAsc = [...snapshots].reverse()

    return success({
      range,
      since: since.toISOString(),
      kpis: {
        latest_status: latest?.status ?? null,
        latest_at: latest?.snapshot_at ?? null,
        snapshots_in_range: totalInRange,
        critical_in_range: criticalInRange,
        uptime_pct,
      },
      series: seriesAsc.map(s => ({
        snapshot_at: s.snapshot_at,
        status: s.status,
        elapsed_ms: s.elapsed_ms,
        data_json: s.data_json,
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}
