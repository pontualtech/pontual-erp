import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * POST /api/internal/create-test-route
 *
 * Endpoint temporario pra criar rota de teste pro Emerson sem tocar em
 * dados reais de cliente. Autenticado via X-Internal-Key (INTERNAL_API_KEY
 * ou CRON_SECRET ou BOT_WEBHOOK_SECRET).
 *
 * Cria uma LogisticsRoute PLANNED hoje com 3 stops ficticios (sem os_id),
 * nomes com prefixo "TESTE" pra diferenciar de dados reais. Coords em
 * Vila Mariana / Bela Vista pra testar geofencing e ETA.
 *
 * Body: { driver_id: string, company_id: string }
 * Resp: { route_id, stops: [...] }
 */
export async function POST(req: NextRequest) {
  const internalKey = req.headers.get('x-internal-key')
  const validKeys = [
    process.env.INTERNAL_API_KEY,
    process.env.BOT_WEBHOOK_SECRET,
    process.env.CRON_SECRET,
    process.env.CHATWOOT_WEBHOOK_SECRET,
  ].filter(Boolean)
  if (!internalKey || !validKeys.includes(internalKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const driverId = body.driver_id as string
  const companyId = body.company_id as string
  if (!driverId || !companyId) {
    return NextResponse.json({ error: 'driver_id e company_id obrigatorios' }, { status: 400 })
  }

  // Apaga rota de teste anterior do mesmo motorista pra reexecucao
  // idempotente (se rodar de novo, nao cria duplicada).
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const existingTestRoute = await prisma.logisticsRoute.findFirst({
    where: {
      company_id: companyId, driver_id: driverId,
      date: { gte: today, lt: tomorrow },
      notes: { contains: 'ROTA DE TESTE' },
    },
  })
  if (existingTestRoute) {
    await prisma.$transaction([
      prisma.logisticsStop.deleteMany({ where: { route_id: existingTestRoute.id } }),
      prisma.logisticsRoute.delete({ where: { id: existingTestRoute.id } }),
    ])
  }

  const testStops = [
    { type: 'COLETA', customer_name: 'TESTE Cliente A (ficticio)', customer_phone: '11999999991', address: 'Rua Afonso Celso, 123, Vila Mariana', lat: -23.5930, lng: -46.6340 },
    { type: 'ENTREGA', customer_name: 'TESTE Cliente B (ficticio)', customer_phone: '11999999992', address: 'Rua Joaquim Tavora, 456, Vila Mariana', lat: -23.5950, lng: -46.6400 },
    { type: 'COLETA', customer_name: 'TESTE Cliente C (ficticio)', customer_phone: '11999999993', address: 'Avenida Paulista, 900, Bela Vista', lat: -23.5640, lng: -46.6530 },
  ]

  const route = await prisma.$transaction(async (tx) => {
    const r = await tx.logisticsRoute.create({
      data: {
        company_id: companyId,
        driver_id: driverId,
        date: new Date(),
        status: 'PLANNED',
        total_stops: testStops.length,
        completed_stops: 0,
        notes: 'ROTA DE TESTE — NAO E CLIENTE REAL (criada via /api/internal/create-test-route)',
      },
    })
    await tx.logisticsStop.createMany({
      data: testStops.map((s, i) => ({
        company_id: companyId, route_id: r.id,
        type: s.type, sequence: i + 1, status: 'PENDING',
        customer_name: s.customer_name, customer_phone: s.customer_phone,
        address: s.address, lat: s.lat, lng: s.lng,
      })),
    })
    return r
  })

  const stops = await prisma.logisticsStop.findMany({
    where: { route_id: route.id },
    orderBy: { sequence: 'asc' },
    select: { id: true, sequence: true, type: true, customer_name: true, address: true, lat: true, lng: true, status: true },
  })

  return NextResponse.json({
    data: {
      route_id: route.id,
      driver_id: driverId,
      date: route.date,
      stops: stops.map(s => ({ ...s, lat: Number(s.lat), lng: Number(s.lng) })),
    },
  })
}
