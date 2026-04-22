import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { getDistanceAndDuration } from '@/lib/distance-matrix'

/**
 * GET /api/driver/eta?stopId=X
 *
 * Retorna tempo estimado (com trafego) do motorista ate a parada
 * especificada. Usa Distance Matrix API (cached 5min) ou fallback
 * haversine+20km/h se API key nao configurada.
 *
 * Fonte da posicao do motorista: UserProfile.last_lat/lng (atualizado
 * pelo app a cada ~10s via /api/driver/location).
 *
 * Usado pelo app motorista pra mostrar "12 min · 5.2 km" no card de
 * proxima parada.
 */
export async function GET(req: NextRequest) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const stopId = req.nextUrl.searchParams.get('stopId')
  if (!stopId) return NextResponse.json({ error: 'stopId obrigatorio' }, { status: 400 })

  const [stop, driver] = await Promise.all([
    prisma.logisticsStop.findFirst({
      where: { id: stopId, company_id: auth.companyId },
      include: { route: { select: { driver_id: true } } },
      select: {
        id: true, lat: true, lng: true, customer_name: true,
        route: { select: { driver_id: true } },
      } as any,
    }),
    prisma.userProfile.findUnique({
      where: { id: auth.id },
      select: { last_lat: true, last_lng: true, last_location_at: true },
    }),
  ])

  if (!stop) return NextResponse.json({ error: 'Parada nao encontrada' }, { status: 404 })
  if ((stop as any).route?.driver_id !== auth.id) {
    return NextResponse.json({ error: 'Parada nao e da sua rota' }, { status: 403 })
  }
  if (!stop.lat || !stop.lng) {
    return NextResponse.json({ error: 'Parada sem coordenadas' }, { status: 400 })
  }
  if (!driver?.last_lat || !driver?.last_lng) {
    return NextResponse.json({ error: 'GPS do motorista indisponivel' }, { status: 400 })
  }

  const result = await getDistanceAndDuration(
    { lat: Number(driver.last_lat), lng: Number(driver.last_lng) },
    { lat: Number(stop.lat), lng: Number(stop.lng) },
  )

  return NextResponse.json({
    data: {
      stop_id: stop.id,
      customer_name: stop.customer_name,
      distance_m: result.distance_m,
      duration_s: result.duration_s,
      eta_minutes: Math.ceil(result.duration_s / 60),
      source: result.source,
      driver_gps_at: driver.last_location_at,
    },
  })
}
