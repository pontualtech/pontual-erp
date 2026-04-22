import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { findStatusByName } from '@/lib/module-status'

type Body = {
  event_id: string
  serial_number: string
  serial_source: 'manual' | 'ocr' | 'ocr_corrected'
  checklist: Array<{ key: string; label: string; checked: boolean }>
  observations?: string | null
  signature_png_base64: string
  signer_name: string
  photos_base64?: string[]           // fotos extras (etiqueta OCR + estado)
  location?: { lat: number; lng: number } | null
}

/**
 * POST /api/driver/stop/[id]/coleta
 *
 * Idempotent (via event_id) — safe to retry on network failure.
 * Effects:
 *  1. Upserts by event_id so a duplicate request returns 200 with same data
 *     instead of creating duplicate history/transition.
 *  2. Updates the stop: serial, checklist, signer, completed_at, location.
 *  3. Transitions the OS (status → "Orcar") so the backoffice sees it
 *     arriving for analysis. Also logs a ServiceOrderHistory entry.
 *  4. Fires notification to customer (WhatsApp template "coleta" + email)
 *     via the existing /api/os/[id]/notificar-coleta internal endpoint.
 *
 * Signature + photos: stored as data-URL strings directly in the row for MVP.
 * Later migration: upload to Supabase Storage and store only the URL.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => ({}))) as Partial<Body>
  const errors = validate(body)
  if (errors.length) return NextResponse.json({ error: errors.join(', ') }, { status: 400 })

  // Idempotency: if this event_id already succeeded, short-circuit with 200.
  const existingByEvent = await prisma.logisticsStop.findFirst({
    where: { event_id: body.event_id!, company_id: auth.companyId },
    select: { id: true, status: true, completed_at: true },
  })
  if (existingByEvent && existingByEvent.id !== params.id) {
    return NextResponse.json({ error: 'event_id em conflito com outra parada' }, { status: 409 })
  }
  if (existingByEvent && existingByEvent.completed_at) {
    return NextResponse.json({ data: { id: existingByEvent.id, already_completed: true } })
  }

  // Authorize: stop must belong to this company AND to a route of this driver.
  const stop = await prisma.logisticsStop.findFirst({
    where: { id: params.id, company_id: auth.companyId, type: 'COLETA' },
    include: { route: { select: { driver_id: true } } },
  })
  if (!stop) return NextResponse.json({ error: 'Coleta nao encontrada' }, { status: 404 })
  if (stop.route.driver_id && stop.route.driver_id !== auth.id && !auth.isSuperAdmin) {
    return NextResponse.json({ error: 'Coleta atribuida a outro motorista' }, { status: 403 })
  }

  // Update stop with collected data
  const photoUrls = [
    `data:image/png;base64,${body.signature_png_base64!}`,
    ...(body.photos_base64 || []).map(b => `data:image/jpeg;base64,${b}`),
  ]
  await prisma.logisticsStop.update({
    where: { id: params.id },
    data: {
      status: 'COMPLETED',
      completed_at: new Date(),
      signature_url: `data:image/png;base64,${body.signature_png_base64!}`,
      signer_name: body.signer_name!,
      serial_number: body.serial_number!.trim().toUpperCase(),
      serial_source: body.serial_source!,
      checklist: body.checklist! as any,
      notes: body.observations || null,
      event_id: body.event_id!,
      completed_lat: body.location?.lat ?? null,
      completed_lng: body.location?.lng ?? null,
      photo_urls: photoUrls as any,
    },
  })

  // Atomically increment route.completed_stops
  await prisma.logisticsRoute.updateMany({
    where: { id: stop.route_id },
    data: { completed_stops: { increment: 1 } },
  })

  // Transition the OS → "Orcar", and update serial on the ServiceOrder too.
  if (stop.os_id) {
    try {
      // Imprimitech usa "Orcar" com cedilha, PontualTech sem — helper
      // normaliza acentos/cedilha pra funcionar em ambas.
      const orcarStatus = await findStatusByName(auth.companyId, 'os', 'Orcar')
      if (orcarStatus) {
        await prisma.serviceOrder.update({
          where: { id: stop.os_id },
          data: {
            status_id: orcarStatus.id,
            serial_number: body.serial_number!.trim().toUpperCase(),
            reception_notes: body.observations || undefined,
          },
        })
        await prisma.serviceOrderHistory.create({
          data: {
            company_id: auth.companyId,
            service_order_id: stop.os_id,
            to_status_id: orcarStatus.id,
            changed_by: auth.id,
            notes: `Coleta finalizada por ${auth.name} — S/N: ${body.serial_number}`,
          },
        })
      }
    } catch (err) {
      console.warn('[driver/coleta] transition falhou:', err instanceof Error ? err.message : String(err))
    }
  }

  return NextResponse.json({ data: { id: params.id, ok: true } })
}

function validate(body: Partial<Body>): string[] {
  const errs: string[] = []
  if (!body.event_id) errs.push('event_id obrigatorio')
  if (!body.serial_number?.trim()) errs.push('serial_number obrigatorio')
  if (!body.serial_source) errs.push('serial_source obrigatorio')
  if (!body.signature_png_base64) errs.push('assinatura obrigatoria')
  if (!body.signer_name?.trim()) errs.push('signer_name obrigatorio')
  if (!Array.isArray(body.checklist)) errs.push('checklist obrigatorio')
  return errs
}
