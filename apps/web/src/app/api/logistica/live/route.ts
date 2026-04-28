import { NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { getDistanceAndDuration } from '@/lib/distance-matrix'

/**
 * GET /api/logistica/live
 *
 * Retorna o estado operacional "ao vivo" pra o dashboard de rastreamento:
 *   - routes: rotas de hoje (com progresso, paradas, posicao atualizada)
 *   - drivers: TODOS os motoristas com localizacao recente (<4h),
 *              inclusive os SEM rota ativa — permite ver onde estao
 *              motoristas parados/livres/entre rotas
 *
 * Pollado a cada ~15s pelo frontend. Permissao: logistica.view.
 */
export async function GET() {
  const auth = await requirePermission('logistics', 'view')
  if (auth instanceof NextResponse) return auth

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const routes = await prisma.logisticsRoute.findMany({
    where: {
      company_id: auth.companyId,
      date: { gte: today, lt: tomorrow },
    },
    include: {
      driver: { select: { id: true, name: true, avatar_url: true } },
      stops: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true, sequence: true, type: true, status: true,
          customer_name: true, address: true,
          lat: true, lng: true, completed_at: true, failure_reason: true,
        },
      },
    },
  })

  // Busca TODOS motoristas (role contem "motorista" ou "driver") da
  // empresa com localizacao reportada nas ultimas 4h. Inclui tanto os
  // que tem rota quanto os que nao tem — o frontend diferencia via flag.
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000)
  const drivers = await prisma.userProfile.findMany({
    where: {
      company_id: auth.companyId,
      is_active: true,
      last_location_at: { gte: fourHoursAgo },
      roles: { OR: [
        { name: { contains: 'motorista', mode: 'insensitive' } },
        { name: { contains: 'driver', mode: 'insensitive' } },
      ]},
    },
    select: {
      id: true,
      name: true,
      avatar_url: true,
      last_lat: true,
      last_lng: true,
      last_location_at: true,
      last_accuracy_m: true,
    },
  })

  // Marca cada motorista com flag "tem rota hoje?" pra o frontend
  // colorir diferente. Motorista sem rota aparece como "Livre".
  const driversWithRouteToday = new Set(
    routes.map(r => r.driver_id).filter(Boolean) as string[]
  )

  // Calcula ETA pra proxima parada PENDING de cada rota IN_PROGRESS.
  // Usa Distance Matrix (Routes API) com cache 5min compartilhado com
  // o ETA do app motorista. Custo controlado: rotas planejadas/finalizadas
  // nao chamam o Google. So as ativas com GPS recente.
  const etaByRoute = new Map<string, { distance_m: number; duration_s: number; eta_minutes: number; source: string; stop_id: string; customer_name: string | null } | null>()
  await Promise.all(routes.map(async (r) => {
    if (r.status !== 'IN_PROGRESS') return
    if (!r.last_lat || !r.last_lng) return
    const nextPending = r.stops.find(s => s.status === 'PENDING' && s.lat && s.lng)
    if (!nextPending || !nextPending.lat || !nextPending.lng) return
    try {
      const eta = await getDistanceAndDuration(
        { lat: Number(r.last_lat), lng: Number(r.last_lng) },
        { lat: Number(nextPending.lat), lng: Number(nextPending.lng) },
      )
      etaByRoute.set(r.id, {
        distance_m: eta.distance_m,
        duration_s: eta.duration_s,
        eta_minutes: Math.ceil(eta.duration_s / 60),
        source: eta.source,
        stop_id: nextPending.id,
        customer_name: nextPending.customer_name,
      })
    } catch {
      etaByRoute.set(r.id, null)
    }
  }))

  return NextResponse.json({
    data: {
      routes: routes.map(r => ({
        id: r.id,
        status: r.status,
        total_stops: r.total_stops,
        completed_stops: r.completed_stops,
        started_at: r.started_at,
        completed_at: r.completed_at,
        driver: r.driver,
        last_location: r.last_lat && r.last_lng ? {
          lat: Number(r.last_lat),
          lng: Number(r.last_lng),
          at: r.last_location_at,
        } : null,
        next_stop_eta: etaByRoute.get(r.id) || null,
        stops: r.stops.map(s => ({
          id: s.id,
          sequence: s.sequence,
          type: s.type,
          status: s.status,
          customer_name: s.customer_name,
          address: s.address,
          lat: s.lat ? Number(s.lat) : null,
          lng: s.lng ? Number(s.lng) : null,
          completed_at: s.completed_at,
          failure_reason: s.failure_reason,
        })),
      })),
      drivers: drivers.map(d => ({
        id: d.id,
        name: d.name,
        avatar_url: d.avatar_url,
        lat: d.last_lat ? Number(d.last_lat) : null,
        lng: d.last_lng ? Number(d.last_lng) : null,
        at: d.last_location_at,
        accuracy_m: d.last_accuracy_m,
        has_route_today: driversWithRouteToday.has(d.id),
      })),
    },
  })
}
