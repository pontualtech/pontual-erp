import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { rateLimit } from '@/lib/rate-limit'
import { haversineKm } from '@/lib/geocoding'

// Raio em metros pra considerar que o motorista chegou na parada.
// 200m e o sweet spot: GPS urbano tem ~10-30m de erro, e prediums grandes
// podem ter 50-100m de extensao. 200m da margem sem ser absurdo.
const ARRIVED_RADIUS_M = 200

// Sanity checks pra detectar GPS spoofado (motorista mal-intencionado
// que finge estar perto do cliente pra triggar geofence/auto-arrive).
// Numeros baseados em fisica + GPS comercial:
//   - accuracy_m > 1000: GPS muito ruim, provavel manipulado
//   - velocidade > 200km/h entre pontos consecutivos: impossivel pra carro
const MAX_ACCURACY_M = 1000
const MAX_SPEED_KMH = 200

/**
 * POST /api/driver/location
 * Body: { lat: number, lng: number, accuracy_m?: number }
 *
 * Called every ~30s from the driver app (via navigator.geolocation.watchPosition).
 * Stores the latest coordinates on today's route so the dashboard can show
 * the driver live on a map. Silently noop if the driver has no route today.
 */
export async function POST(req: NextRequest) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  // Guard: at most 1 update every 10s per driver — anything faster is either
  // a bug in the client or a waste of DB writes.
  const rl = rateLimit(`driver-loc:${auth.id}`, 6, 60_000) // 6/min = ~1 per 10s
  if (!rl.allowed) return NextResponse.json({ ok: true, throttled: true })

  const body = await req.json().catch(() => ({}))
  const lat = Number(body.lat)
  const lng = Number(body.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat/lng invalidos' }, { status: 400 })
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'lat/lng fora de faixa' }, { status: 400 })
  }

  const accuracy = Number.isFinite(body.accuracy_m) ? Math.round(body.accuracy_m) : null
  const now = new Date()

  // Sanity check 1: accuracy absurda — GPS comercial moderno raramente
  // ultrapassa 100m em ambiente urbano. Se chegar com >1000m, ou e dispositivo
  // com problema sério ou alguem manipulando. Loga e pula update.
  if (accuracy !== null && accuracy > MAX_ACCURACY_M) {
    console.warn(`[driver/location] accuracy fora da faixa: ${accuracy}m (driver=${auth.id.slice(0,8)})`)
    return NextResponse.json({ ok: false, rejected: 'accuracy_out_of_range', accuracy_m: accuracy }, { status: 400 })
  }

  // Sanity check 2: velocidade entre o ponto anterior e o novo. Se ficar
  // acima de 200km/h, nao e fisicamente possivel pra carro/moto urbano.
  // Provavelmente GPS spoof — loga e pula. Comparamos com last_lat/lng do
  // user_profile (set no update anterior).
  const prev = await prisma.userProfile.findUnique({
    where: { id: auth.id },
    select: { last_lat: true, last_lng: true, last_location_at: true },
  })
  if (prev?.last_lat && prev?.last_lng && prev?.last_location_at) {
    const prevLat = Number(prev.last_lat)
    const prevLng = Number(prev.last_lng)
    const distKm = haversineKm({ lat: prevLat, lng: prevLng }, { lat, lng })
    const elapsedHours = (now.getTime() - prev.last_location_at.getTime()) / (1000 * 60 * 60)
    if (elapsedHours > 0 && elapsedHours < 0.5) {
      // So checa se intervalo e <30min. Se motorista voltou apos almoco,
      // teleporte de 50km e legitimo.
      const speedKmh = distKm / elapsedHours
      if (speedKmh > MAX_SPEED_KMH) {
        console.warn(`[driver/location] velocidade impossivel: ${speedKmh.toFixed(0)}km/h (driver=${auth.id.slice(0,8)}, ${distKm.toFixed(1)}km em ${(elapsedHours*60).toFixed(1)}min)`)
        return NextResponse.json({ ok: false, rejected: 'impossible_speed', speed_kmh: Math.round(speedKmh) }, { status: 400 })
      }
    }
  }

  // Sempre atualiza a posicao do motorista no user_profile — isso permite
  // que /logistica/live mostre o motorista no mapa mesmo SEM rota ativa
  // (ex: parado na empresa, entre rotas, saindo pra banco).
  // Em paralelo, insere no historico pra trail/replay/auditoria.
  await Promise.all([
    prisma.userProfile.update({
      where: { id: auth.id },
      data: {
        last_lat: lat,
        last_lng: lng,
        last_location_at: now,
        last_accuracy_m: accuracy,
      },
    }).catch(e => console.warn('[driver/location] failed updating user_profile:', e?.message)),
    prisma.driverLocationHistory.create({
      data: {
        company_id: auth.companyId,
        driver_id: auth.id,
        lat,
        lng,
        accuracy_m: accuracy,
        captured_at: now,
      },
    }).catch(e => console.warn('[driver/location] failed inserting history:', e?.message)),
  ])

  // Se tiver rota hoje, tambem atualiza la pra manter o historico "in route"
  // funcional (cards de progresso no sidebar).
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const route = await prisma.logisticsRoute.findFirst({
    where: { company_id: auth.companyId, driver_id: auth.id, date: { gte: today, lt: tomorrow } },
    select: { id: true },
  })
  let geofenceTriggered: { stop_id: string; customer_name: string | null; distance_m: number } | null = null
  if (route) {
    await prisma.logisticsRoute.update({
      where: { id: route.id },
      data: { last_lat: lat, last_lng: lng, last_location_at: now },
    })

    // Geofencing: se ha proxima parada PENDING com lat/lng e o motorista
    // estiver a < ARRIVED_RADIUS_M dela, marca chegada automatica.
    // Pega a parada com menor sequence ainda pendente (a "proxima" da rota).
    const nextPending = await prisma.logisticsStop.findFirst({
      where: {
        route_id: route.id, company_id: auth.companyId,
        status: 'PENDING',
        lat: { not: null }, lng: { not: null },
      },
      orderBy: { sequence: 'asc' },
      select: { id: true, customer_name: true, lat: true, lng: true },
    })
    if (nextPending && nextPending.lat && nextPending.lng) {
      const distKm = haversineKm(
        { lat, lng },
        { lat: Number(nextPending.lat), lng: Number(nextPending.lng) }
      )
      const distM = Math.round(distKm * 1000)
      if (distM <= ARRIVED_RADIUS_M) {
        // Auto-marca chegada na parada (status=ARRIVED) + log
        await prisma.logisticsStop.update({
          where: { id: nextPending.id },
          data: { status: 'ARRIVED', arrived_at: now, completed_lat: lat, completed_lng: lng },
        }).then(() => {
          geofenceTriggered = {
            stop_id: nextPending.id,
            customer_name: nextPending.customer_name,
            distance_m: distM,
          }
          console.log(`[driver/location] geofence: ${auth.id} chegou em ${nextPending.customer_name} (${distM}m)`)
        }).catch(e => console.warn('[driver/location] auto-arrive failed:', e?.message))
      }
    }
  }

  return NextResponse.json({ ok: true, has_route: !!route, geofence: geofenceTriggered })
}
