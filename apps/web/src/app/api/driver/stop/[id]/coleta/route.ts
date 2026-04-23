import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { findStatusByName } from '@/lib/module-status'
import { sendCompanyEmail } from '@/lib/send-email'
import { getColetaConcluidaEmail } from '@/lib/email-templates/coleta-concluida'
import { sendWhatsAppCloud } from '@/lib/whatsapp/cloud-api'

function portalUrl(companyId: string): string {
  if (companyId === 'pontualtech-001') return 'https://portal.pontualtech.com.br/portal/pontualtech'
  if (companyId === '86c829cf-32ed-4e40-80cd-59ce4178aa1a') return 'https://portal.imprimitech.com.br/portal/imprimitech'
  return 'https://portal.pontualtech.com.br/portal/pontualtech'
}

function supportWa(companyId: string): string {
  if (companyId === 'pontualtech-001') return 'https://wa.me/551126263841'
  if (companyId === '86c829cf-32ed-4e40-80cd-59ce4178aa1a') return 'https://wa.me/551150439869'
  return 'https://wa.me/551126263841'
}

/**
 * Envia confirmacao da coleta por e-mail (rico, com equipamento/serial/
 * assinatura/foto) e por WhatsApp (texto curto). Fire-and-forget — nao
 * bloqueia o fluxo do motorista. Template editavel em /config/email-templates.
 */
async function sendColetaDoneNotifications(
  companyId: string,
  stopId: string,
  signerName: string,
  signatureDataUrl: string,
  photoDataUrl: string | null,
  checklist: Array<{ label: string; checked: boolean }>,
): Promise<void> {
  try {
    const stop = await prisma.logisticsStop.findFirst({
      where: { id: stopId, company_id: companyId },
      select: { os_id: true, serial_number: true },
    })
    if (!stop?.os_id) return

    const os = await prisma.serviceOrder.findFirst({
      where: { id: stop.os_id, company_id: companyId, deleted_at: null },
      select: {
        os_number: true,
        equipment_type: true,
        equipment_brand: true,
        equipment_model: true,
        reported_issue: true,
        customers: { select: { legal_name: true, email: true, mobile: true, phone: true } },
      },
    })
    if (!os) return

    const company = await prisma.company.findUnique({
      where: { id: companyId }, select: { name: true },
    })

    const equipmentCompleto = [os.equipment_type, os.equipment_brand, os.equipment_model]
      .filter(Boolean).join(' ') || 'Equipamento'
    const varsBase = {
      cliente: os.customers?.legal_name || 'Cliente',
      empresa: company?.name || 'PontualTech',
      os_number: os.os_number,
      equipamento_completo: equipmentCompleto,
      serial_number: stop.serial_number || 's/n',
      defeito_reportado: os.reported_issue || 'Sem descricao',
      recebido_por: signerName,
      data_hora: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      checklist,
      signature_url: signatureDataUrl,
      photo_url: photoDataUrl,
      link_portal: portalUrl(companyId),
      link_suporte: supportWa(companyId),
    }

    // Email — manda sempre que houver e-mail cadastrado
    if (os.customers?.email) {
      try {
        const tpl = await getColetaConcluidaEmail(companyId, varsBase)
        await sendCompanyEmail(companyId, os.customers.email, tpl.subject, tpl.html)
      } catch (err) {
        console.warn('[driver/coleta] email falhou:', err instanceof Error ? err.message : String(err))
      }
    }

    // WhatsApp — mensagem curta. sendWhatsAppCloud tem fallback automatico
    // pra Evolution em caso de 131047 (fora da janela 24h) ou timeout.
    const phone = os.customers?.mobile || os.customers?.phone
    if (phone) {
      const firstName = (os.customers?.legal_name || 'Cliente').split(' ')[0]
      const msg = `Ola ${firstName}! Coletamos seu equipamento com sucesso.

*${equipmentCompleto}*
Serie: ${stop.serial_number || 's/n'}
OS #${os.os_number}

Em breve voce recebera o *orcamento por e-mail*. Basta aprovar pelo portal pra iniciarmos o reparo.

Acompanhar: ${portalUrl(companyId)}
Suporte: ${supportWa(companyId)}

_Equipe ${company?.name || 'PontualTech'}_`
      try {
        await sendWhatsAppCloud(companyId, phone, msg)
      } catch (err) {
        console.warn('[driver/coleta] whatsapp falhou:', err instanceof Error ? err.message : String(err))
      }
    }
  } catch (err) {
    console.warn('[driver/coleta] notifications outer:', err instanceof Error ? err.message : String(err))
  }
}

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

  // Notifica cliente (email rico + whatsapp) — fire-and-forget, nao bloqueia
  const sigUrl = `data:image/png;base64,${body.signature_png_base64!}`
  const firstPhotoExtra = (body.photos_base64 || [])[0]
  const photoUrl = firstPhotoExtra ? `data:image/jpeg;base64,${firstPhotoExtra}` : null
  void sendColetaDoneNotifications(
    auth.companyId,
    params.id,
    body.signer_name!,
    sigUrl,
    photoUrl,
    body.checklist!,
  ).catch(() => {})

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
