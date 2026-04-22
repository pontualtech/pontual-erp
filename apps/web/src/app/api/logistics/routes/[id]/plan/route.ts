import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { requireDriver } from '@/lib/driver-auth'
import { success, error, handleError } from '@/lib/api-response'
import { computeRoutePlan, type RoutePlan } from '@/lib/google-routes'

/**
 * GET /api/logistics/routes/[id]/plan
 *
 * Retorna o plano de rota REAL (pelas ruas, via Google Routes API):
 *  - polyline encoded pra desenhar no mapa
 *  - legs: distancia/tempo por trecho entre paradas consecutivas
 *  - totais da rota
 *
 * Cache: o resultado e guardado em Setting (key=route-plan:<routeId>)
 * com TTL ~24h — rotas mudam pouco depois de planejadas, entao nao
 * vale pagar consulta nova a cada page view.
 *
 * Acesso: atendente (permission os:view) OU motorista da rota.
 * Query ?refresh=1 invalida cache e re-computa.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Aceita auth de atendente OU motorista (os dois precisam ver a rota)
    let companyId: string | null = null
    let driverId: string | null = null
    const permResult = await requirePermission('os', 'view').catch(() => null)
    if (permResult && !(permResult instanceof NextResponse)) {
      companyId = permResult.companyId
    } else {
      const driver = await requireDriver()
      if (driver instanceof NextResponse) return driver
      companyId = driver.companyId
      driverId = driver.id
    }
    if (!companyId) return error('Unauthorized', 401)

    const refresh = req.nextUrl.searchParams.get('refresh') === '1'
    const cacheKey = `route-plan:${params.id}`

    // Verifica cache
    if (!refresh) {
      const cached = await prisma.setting.findFirst({
        where: { company_id: companyId, key: cacheKey },
      })
      if (cached) {
        try {
          const parsed = JSON.parse(cached.value) as RoutePlan & { cached_at: string }
          const ageMs = Date.now() - new Date(parsed.cached_at).getTime()
          if (ageMs < CACHE_TTL_MS) {
            return success({ ...parsed, cached: true, age_ms: ageMs })
          }
        } catch { /* cache corrompido — segue pra recalcular */ }
      }
    }

    // Busca stops em sequence
    const route = await prisma.logisticsRoute.findFirst({
      where: { id: params.id, company_id: companyId },
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          select: { id: true, lat: true, lng: true, sequence: true },
        },
      },
    })
    if (!route) return error('Rota nao encontrada', 404)

    // Se motorista, valida que e o dono da rota
    if (driverId && route.driver_id && route.driver_id !== driverId) {
      return error('Rota de outro motorista', 403)
    }

    const waypoints = route.stops
      .filter(s => s.lat != null && s.lng != null)
      .map(s => ({
        stop_id: s.id,
        lat: Number(s.lat),
        lng: Number(s.lng),
      }))

    if (waypoints.length < 2) {
      return success({
        polyline: '', total_distance_m: 0, total_duration_s: 0, legs: [],
        source: 'haversine', cached: false,
      })
    }

    const plan = await computeRoutePlan(waypoints)

    // So cacheia se foi resposta real do Google. Fallback haversine
    // pode ser transient (API down, quota, batching); nao trava por 24h.
    if (plan.source === 'google') {
      const toSave = JSON.stringify({ ...plan, cached_at: new Date().toISOString() })
      await prisma.setting.upsert({
        where: { company_id_key: { company_id: companyId, key: cacheKey } },
        create: { company_id: companyId, key: cacheKey, value: toSave, type: 'json' },
        update: { value: toSave, updated_at: new Date() },
      })
    }

    return success({ ...plan, cached: false })
  } catch (err) {
    return handleError(err)
  }
}
