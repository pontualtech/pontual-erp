import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { geocodeAddress } from '@/lib/geocoding'

/**
 * POST /api/driver/stop/adhoc
 * Body: { os_id: string, type: 'COLETA' | 'ENTREGA' }
 *
 * Cria uma parada avulsa (fora de rota planejada). Motorista chega no
 * cliente e lanca na hora. Comportamento:
 *  1. Procura rota "Avulsa" do motorista pra HOJE. Se nao existe, cria.
 *  2. Cria LogisticsStop vinculado a essa rota com sequence = ultimo+1.
 *  3. Retorna stop_id pra redirect imediato pro flow de coleta/entrega.
 *
 * Geocoda endereco do cliente se ele nao tem lat/lng ainda.
 */
export async function POST(req: NextRequest) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const osId = String(body.os_id || '')
  const type = String(body.type || '').toUpperCase() as 'COLETA' | 'ENTREGA'
  if (!osId) return NextResponse.json({ error: 'os_id obrigatorio' }, { status: 400 })
  if (type !== 'COLETA' && type !== 'ENTREGA') {
    return NextResponse.json({ error: 'type deve ser COLETA ou ENTREGA' }, { status: 400 })
  }

  const os = await prisma.serviceOrder.findFirst({
    where: { id: osId, company_id: auth.companyId, deleted_at: null },
    include: {
      customers: {
        select: {
          id: true, legal_name: true, trade_name: true, mobile: true, phone: true,
          address_street: true, address_complement: true, address_number: true,
          address_neighborhood: true, address_city: true, address_state: true, address_zip: true,
          address_lat: true, address_lng: true,
        },
      },
    },
  })
  if (!os) return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
  if (!os.customers) return NextResponse.json({ error: 'OS sem cliente' }, { status: 400 })

  const c = os.customers
  const address = [
    c.address_street,
    c.address_number ? `${c.address_number}` : null,
    c.address_neighborhood,
    c.address_city && c.address_state ? `${c.address_city}/${c.address_state}` : null,
    c.address_zip,
  ].filter(Boolean).join(', ')
  if (!address) return NextResponse.json({ error: 'Cliente sem endereco' }, { status: 400 })

  // Coords: usa do cliente OU geocoda agora
  let lat = c.address_lat ? Number(c.address_lat) : null
  let lng = c.address_lng ? Number(c.address_lng) : null
  if (lat == null || lng == null) {
    try {
      const coords = await geocodeAddress(address)
      if (coords) {
        lat = coords.lat
        lng = coords.lng
        // Salva no customer pra proxima vez
        await prisma.customer.update({
          where: { id: c.id },
          data: { address_lat: coords.lat, address_lng: coords.lng },
        })
      }
    } catch { /* segue sem coords */ }
  }

  // Procura rota avulsa de hoje pro motorista — usa notes='Avulsa' como tag.
  // Se nao existe, cria.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  let route = await prisma.logisticsRoute.findFirst({
    where: {
      company_id: auth.companyId,
      driver_id: auth.id,
      date: { gte: today, lt: tomorrow },
      notes: 'Avulsa',
    },
  })
  if (!route) {
    route = await prisma.logisticsRoute.create({
      data: {
        company_id: auth.companyId,
        driver_id: auth.id,
        date: today,
        status: 'IN_PROGRESS', // ja comeca em andamento (motorista ja esta no local)
        started_at: new Date(),
        total_stops: 0,
        completed_stops: 0,
        notes: 'Avulsa',
      },
    })
  }

  // Sequence = max+1 dentro da rota avulsa
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
      os_id: os.id,
      type,
      sequence,
      status: 'ARRIVED', // motorista ja esta la
      arrived_at: new Date(),
      customer_name: c.trade_name || c.legal_name,
      customer_phone: c.mobile || c.phone,
      address,
      address_complement: c.address_complement,
      lat: lat as any,
      lng: lng as any,
    },
  })

  // Incrementa total_stops
  await prisma.logisticsRoute.updateMany({
    where: { id: route.id },
    data: { total_stops: { increment: 1 } },
  })

  return NextResponse.json({
    data: {
      stop_id: stop.id,
      route_id: route.id,
      type,
      redirect: type === 'COLETA'
        ? `/motorista/coleta/${stop.id}`
        : `/motorista/entrega/${stop.id}`,
    },
  })
}
