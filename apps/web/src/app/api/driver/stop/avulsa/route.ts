import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { geocodeAddress } from '@/lib/geocoding'

/**
 * POST /api/driver/stop/avulsa
 * Body: { title: string, address: string, notes?: string }
 *
 * Cria uma parada operacional sem vinculo com OS — ex: retirar peca em
 * fornecedor, passar no mecanico. Nao e COLETA nem ENTREGA; e do tipo
 * AVULSA, com fluxo simplificado (so Cheguei + Concluido, sem checklist,
 * sem pagamento, sem assinatura).
 *
 * Regra de rota:
 *  1. Se o motorista ja tem rota de hoje (qualquer, normal ou Avulsa),
 *     anexa a parada no fim.
 *  2. Se nao tem, cria uma rota "Avulsa" IN_PROGRESS.
 */
export async function POST(req: NextRequest) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const title = String(body.title || '').trim()
  const address = String(body.address || '').trim()
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  if (!title) return NextResponse.json({ error: 'title obrigatorio' }, { status: 400 })
  if (!address) return NextResponse.json({ error: 'address obrigatorio' }, { status: 400 })

  // Geocoda endereco se possivel (best-effort — segue sem coords se falhar)
  let lat: number | null = null
  let lng: number | null = null
  try {
    const coords = await geocodeAddress(address)
    if (coords) { lat = coords.lat; lng = coords.lng }
  } catch { /* silent */ }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  // Pega rota ativa de hoje — preferencialmente normal, senao a Avulsa,
  // senao cria uma nova Avulsa.
  let route = await prisma.logisticsRoute.findFirst({
    where: {
      company_id: auth.companyId,
      driver_id: auth.id,
      date: { gte: today, lt: tomorrow },
      status: { in: ['PLANNED', 'IN_PROGRESS'] },
    },
    orderBy: { created_at: 'asc' },
  })
  if (!route) {
    route = await prisma.logisticsRoute.create({
      data: {
        company_id: auth.companyId,
        driver_id: auth.id,
        date: today,
        status: 'IN_PROGRESS',
        started_at: new Date(),
        total_stops: 0,
        completed_stops: 0,
        notes: 'Avulsa',
      },
    })
  }

  const last = await prisma.logisticsStop.findFirst({
    where: { route_id: route.id, company_id: auth.companyId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  })
  const sequence = (last?.sequence || 0) + 1

  const stop = await prisma.logisticsStop.create({
    data: {
      company_id: auth.companyId,
      route_id: route.id,
      os_id: null,
      type: 'AVULSA',
      sequence,
      status: 'PENDING',
      customer_name: title,
      address,
      lat: lat as any,
      lng: lng as any,
      notes: notes || null,
    },
  })

  await prisma.logisticsRoute.updateMany({
    where: { id: route.id },
    data: { total_stops: { increment: 1 } },
  })

  return NextResponse.json({
    data: {
      stop_id: stop.id,
      route_id: route.id,
      sequence,
      geocoded: lat != null && lng != null,
    },
  })
}
