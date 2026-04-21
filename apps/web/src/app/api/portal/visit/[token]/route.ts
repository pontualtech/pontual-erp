import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { verifyVisitToken } from '@/lib/visit-token'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

/**
 * GET  /api/portal/visit/[token]        — valida + retorna dados pra UI
 * POST /api/portal/visit/[token]        — action: 'confirm' | 'reschedule' (+reason + new_date)
 *
 * Público (sem auth do cliente). Token HMAC é prova de autorização —
 * só quem recebeu o link via WhatsApp consegue acionar.
 * Rate limit por IP pra evitar scraping.
 */

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(`visit-get:${getClientIp(req)}`, 30, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: 'Muitas tentativas' }, { status: 429 })

  if (!verifyVisitToken(params.token)) {
    return NextResponse.json({ error: 'Link invalido' }, { status: 404 })
  }

  const stop = await prisma.logisticsStop.findFirst({
    where: { visit_confirm_token: params.token },
    include: {
      route: {
        select: {
          driver: { select: { name: true } },
          company_id: true,
        },
      },
    },
  })
  if (!stop) return NextResponse.json({ error: 'Visita nao encontrada' }, { status: 404 })

  const company = await prisma.company.findUnique({
    where: { id: stop.route.company_id },
    select: { name: true, slug: true },
  })

  const osData = stop.os_id ? await prisma.serviceOrder.findFirst({
    where: { id: stop.os_id },
    select: {
      os_number: true,
      equipment_type: true,
      equipment_brand: true,
      equipment_model: true,
    },
  }) : null

  return NextResponse.json({
    data: {
      customer_name: stop.customer_name,
      address: stop.address,
      type: stop.type,                     // COLETA | ENTREGA
      driver_name: stop.route.driver?.name || null,
      company_name: company?.name || '',
      eta_minutes: stop.visit_eta_minutes,
      notified_at: stop.visit_notified_at,
      confirmed_at: stop.visit_confirmed_at,
      reschedule_at: stop.visit_reschedule_at,
      reschedule_note: stop.visit_reschedule_note,
      status: stop.status,
      os: osData ? {
        number: osData.os_number,
        equipment: [osData.equipment_type, osData.equipment_brand, osData.equipment_model].filter(Boolean).join(' '),
      } : null,
    },
  })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(`visit-post:${getClientIp(req)}`, 10, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: 'Muitas tentativas' }, { status: 429 })

  if (!verifyVisitToken(params.token)) {
    return NextResponse.json({ error: 'Link invalido' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const action = body.action as 'confirm' | 'reschedule' | undefined
  if (action !== 'confirm' && action !== 'reschedule') {
    return NextResponse.json({ error: 'action deve ser confirm ou reschedule' }, { status: 400 })
  }

  const stop = await prisma.logisticsStop.findFirst({
    where: { visit_confirm_token: params.token },
    select: { id: true, status: true, company_id: true, route_id: true },
  })
  if (!stop) return NextResponse.json({ error: 'Visita nao encontrada' }, { status: 404 })
  if (stop.status === 'COMPLETED' || stop.status === 'FAILED') {
    return NextResponse.json({ error: 'Visita ja finalizada' }, { status: 400 })
  }

  if (action === 'confirm') {
    await prisma.logisticsStop.update({
      where: { id: stop.id },
      data: {
        visit_confirmed_at: new Date(),
        visit_reschedule_at: null,
        visit_reschedule_note: null,
      },
    })
    return NextResponse.json({ data: { confirmed_at: new Date() } })
  }

  // reschedule
  const reason = (body.note || body.reason || '').toString().trim().slice(0, 500)
  await prisma.logisticsStop.update({
    where: { id: stop.id },
    data: {
      visit_reschedule_at: new Date(),
      visit_reschedule_note: reason || 'Cliente solicitou remarcar',
      visit_confirmed_at: null,
    },
  })
  return NextResponse.json({ data: { reschedule_at: new Date(), note: reason } })
}
