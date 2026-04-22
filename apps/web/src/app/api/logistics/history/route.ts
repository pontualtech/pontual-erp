import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { paginated, handleError } from '@/lib/api-response'

/**
 * GET /api/logistics/history
 * Query:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (default: ultimos 30 dias)
 *   ?driver_id=<uuid>
 *   ?status=PLANNED|IN_PROGRESS|COMPLETED
 *   ?search=<texto>  (busca em driver name / notes)
 *   ?page=1&limit=20
 *
 * Diferente do /api/logistics/routes que e orientado a "rotas de hoje",
 * este endpoint cobre o historico completo com filtros amplos pra
 * alimentar a tela de historico + dashboard.
 *
 * Devolve paginated. Cada item ja vem com totals (completed_stops /
 * failed_stops / total_stops) e driver expandido pra consumo direto
 * na UI sem precisar de query extra por rota.
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, Number(url.get('limit') || '20')))

    const now = new Date()
    const defaultFrom = new Date(now)
    defaultFrom.setDate(defaultFrom.getDate() - 30)
    const fromStr = url.get('from')
    const toStr = url.get('to')
    const from = fromStr ? new Date(fromStr + 'T00:00:00') : defaultFrom
    const to = toStr ? new Date(toStr + 'T23:59:59') : now

    const driverId = url.get('driver_id')
    const status = url.get('status')
    const search = (url.get('search') || '').trim()

    const where: any = {
      company_id: user.companyId,
      date: { gte: from, lte: to },
    }
    if (driverId) where.driver_id = driverId
    if (status) where.status = status
    if (search) {
      where.OR = [
        { notes: { contains: search, mode: 'insensitive' } },
        { driver: { name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [rows, total] = await Promise.all([
      prisma.logisticsRoute.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
        include: {
          driver: { select: { id: true, name: true, phone: true, avatar_url: true } },
          stops: {
            select: {
              id: true,
              status: true,
              type: true,
              failure_reason: true,
              completed_at: true,
              arrived_at: true,
            },
          },
        },
      }),
      prisma.logisticsRoute.count({ where }),
    ])

    const data = rows.map(r => {
      const stops = r.stops || []
      const completed = stops.filter(s => s.status === 'COMPLETED').length
      const failed = stops.filter(s => s.status === 'FAILED').length
      const pending = stops.length - completed - failed
      // tempo medio por stop (minutos) quando tem arrived + completed
      const durationsMs = stops
        .filter(s => s.arrived_at && s.completed_at)
        .map(s => s.completed_at!.getTime() - s.arrived_at!.getTime())
      const avgMin = durationsMs.length > 0
        ? Math.round(durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length / 60000)
        : null
      return {
        id: r.id,
        date: r.date,
        status: r.status,
        started_at: r.started_at,
        completed_at: r.completed_at,
        notes: r.notes,
        driver: r.driver,
        total_stops: stops.length,
        completed_stops: completed,
        failed_stops: failed,
        pending_stops: pending,
        success_rate: stops.length > 0 ? Math.round((completed / stops.length) * 100) : 0,
        avg_minutes_per_stop: avgMin,
      }
    })

    return paginated(data, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}
