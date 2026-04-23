import { NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'

/**
 * GET /api/driver/rota/hoje
 *
 * Returns today's route for the authenticated driver, including every stop
 * (coletas e entregas) with enough info to render the list and open the
 * detail flow without another fetch. OS-level data is joined when the stop
 * has an os_id (service order number, customer contact, equipment, amount).
 */
export async function GET() {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  // Day window in SP time — Prisma stores dates as UTC; we want "today from
  // the driver's perspective".
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const route = await prisma.logisticsRoute.findFirst({
    where: {
      company_id: auth.companyId,
      driver_id: auth.id,
      date: { gte: today, lt: tomorrow },
    },
    include: {
      stops: {
        orderBy: { sequence: 'asc' },
      },
    },
  })

  if (!route) {
    return NextResponse.json({ data: { route: null, stops: [] } })
  }

  // Enrich stops with OS data (os_number, equipment, total_cost, customer).
  const osIds = route.stops.map(s => s.os_id).filter(Boolean) as string[]
  const osList = osIds.length === 0 ? [] : await prisma.serviceOrder.findMany({
    where: { id: { in: osIds }, company_id: auth.companyId },
    select: {
      id: true,
      os_number: true,
      equipment_type: true,
      equipment_brand: true,
      equipment_model: true,
      reported_issue: true,
      diagnosis: true,
      total_cost: true,
      customers: { select: { legal_name: true, mobile: true, phone: true } },
    },
  })
  const osById = new Map(osList.map(o => [o.id, o]))

  const stops = route.stops.map(s => {
    const os = s.os_id ? osById.get(s.os_id) : null
    return {
      id: s.id,
      type: s.type,                      // COLETA | ENTREGA | AVULSA
      status: s.status,                  // PENDING | EN_ROUTE | ARRIVED | COMPLETED | FAILED
      sequence: s.sequence,
      customer_name: s.customer_name || os?.customers?.legal_name || '',
      customer_phone: s.customer_phone || os?.customers?.mobile || os?.customers?.phone || '',
      address: [s.address, s.address_complement].filter(Boolean).join(' — '),
      lat: s.lat ? Number(s.lat) : null,
      lng: s.lng ? Number(s.lng) : null,
      notes: s.notes,                    // descricao livre (AVULSA usa como titulo de tarefa)
      window_start: s.scheduled_window_start,
      window_end: s.scheduled_window_end,
      completed_at: s.completed_at,
      failure_reason: s.failure_reason,
      visit_notified_at: s.visit_notified_at,
      visit_confirmed_at: s.visit_confirmed_at,
      visit_reschedule_at: s.visit_reschedule_at,
      visit_reschedule_note: s.visit_reschedule_note,
      visit_eta_minutes: s.visit_eta_minutes,
      os: os ? {
        id: os.id,
        number: os.os_number,
        equipment: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
        reported_issue: os.reported_issue,
        diagnosis: os.diagnosis,
        total_cost_cents: os.total_cost || 0,
      } : null,
    }
  })

  // Company info pra tema do app — motorista ve cores diferentes
  // entre PontualTech (indigo) e Imprimitech (laranja) sem precisar
  // configurar nada.
  const company = await prisma.company.findUnique({
    where: { id: auth.companyId },
    select: { slug: true, name: true, logo: true },
  })

  return NextResponse.json({
    data: {
      route: {
        id: route.id,
        date: route.date,
        status: route.status,
        total_stops: route.total_stops,
        completed_stops: route.completed_stops,
        started_at: route.started_at,
      },
      stops,
      company: company
        ? { slug: company.slug, name: company.name, logo: company.logo }
        : null,
    },
  })
}
