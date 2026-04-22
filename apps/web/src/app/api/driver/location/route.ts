import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { rateLimit } from '@/lib/rate-limit'

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

  // Sempre atualiza a posicao do motorista no user_profile — isso permite
  // que /logistica/live mostre o motorista no mapa mesmo SEM rota ativa
  // (ex: parado na empresa, entre rotas, saindo pra banco).
  await prisma.userProfile.update({
    where: { id: auth.id },
    data: {
      last_lat: lat,
      last_lng: lng,
      last_location_at: now,
      last_accuracy_m: accuracy,
    },
  }).catch(e => console.warn('[driver/location] failed updating user_profile:', e?.message))

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
  if (route) {
    await prisma.logisticsRoute.update({
      where: { id: route.id },
      data: { last_lat: lat, last_lng: lng, last_location_at: now },
    })
  }

  return NextResponse.json({ ok: true, has_route: !!route })
}
