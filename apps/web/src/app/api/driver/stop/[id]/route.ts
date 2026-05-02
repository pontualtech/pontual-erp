import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'

/**
 * GET /api/driver/stop/[id]
 *
 * Retorna detalhe completo de uma parada pra motorista preencher ou
 * EDITAR coleta/entrega. Inclui dados que nao vem em /rota/hoje:
 *   - serial_number + serial_source
 *   - checklist (array)
 *   - observations (notes)
 *   - signer_name + signature_url
 *   - photo_urls
 *   - completed_at + status
 *   - payment_method + payment_amount_cents (pra entrega paga)
 *
 * Guarda: stop precisa pertencer ao motorista autenticado.
 *
 * Usado pela tela /motorista/coleta/[stopId] pra pre-carregar o form
 * quando o motorista reabre uma coleta ja finalizada (edicao).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const stop = await prisma.logisticsStop.findFirst({
    where: { id: params.id, company_id: auth.companyId },
    include: { route: { select: { driver_id: true } } },
  })
  if (!stop) return NextResponse.json({ error: 'Parada nao encontrada' }, { status: 404 })
  if (stop.route.driver_id && stop.route.driver_id !== auth.id && !auth.isSuperAdmin) {
    return NextResponse.json({ error: 'Parada nao pertence a sua rota' }, { status: 403 })
  }

  return NextResponse.json({
    data: {
      id: stop.id,
      type: stop.type,
      status: stop.status,
      sequence: stop.sequence,
      customer_name: stop.customer_name,
      customer_phone: stop.customer_phone,
      address: stop.address,
      address_complement: stop.address_complement,
      lat: stop.lat ? Number(stop.lat) : null,
      lng: stop.lng ? Number(stop.lng) : null,
      // Dados de execucao (coleta/entrega):
      serial_number: stop.serial_number,
      serial_source: stop.serial_source,
      checklist: stop.checklist,
      observations: stop.notes,
      signer_name: stop.signer_name,
      signature_url: stop.signature_url,
      photo_urls: stop.photo_urls,
      completed_at: stop.completed_at,
      arrived_at: stop.arrived_at,
      payment_method: stop.payment_method,
      payment_amount_cents: stop.payment_amount_cents,
      payment_receipt_url: stop.payment_receipt_url,
      visit_reschedule_note: stop.visit_reschedule_note,
    },
  })
}

/**
 * PATCH /api/driver/stop/[id]
 *
 * Permite motorista EDITAR uma coleta/entrega ja finalizada (COMPLETED).
 * Campos editaveis: serial_number, observations, checklist, signer_name,
 * signature, photos, payment_method, payment_amount_cents.
 *
 * NAO re-transiciona OS (diferente do POST /coleta que muda status da OS
 * pra "Orcar"). Apenas atualiza os campos da parada. Motorista nao pode
 * desfazer a OS — so corrigir dados cadastrados.
 *
 * Caso de uso: motorista errou numero de serie, quer adicionar foto extra,
 * ou o cliente reclamou de algo no checklist.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))

  const stop = await prisma.logisticsStop.findFirst({
    where: { id: params.id, company_id: auth.companyId },
    include: { route: { select: { driver_id: true } } },
  })
  if (!stop) return NextResponse.json({ error: 'Parada nao encontrada' }, { status: 404 })
  if (stop.route.driver_id && stop.route.driver_id !== auth.id && !auth.isSuperAdmin) {
    return NextResponse.json({ error: 'Parada nao pertence a sua rota' }, { status: 403 })
  }
  if (stop.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'So pode editar paradas ja finalizadas — use POST pra finalizar' }, { status: 400 })
  }

  // Monta update so com campos que vieram no body (parcial OK)
  const data: any = {}
  if (typeof body.serial_number === 'string') {
    data.serial_number = body.serial_number.trim().toUpperCase()
    data.serial_source = body.serial_source || 'manual'
  }
  if (typeof body.observations === 'string') data.notes = body.observations.trim() || null
  if (Array.isArray(body.checklist)) data.checklist = body.checklist as any
  if (typeof body.signer_name === 'string' && body.signer_name.trim()) data.signer_name = body.signer_name.trim()
  if (typeof body.signature_png_base64 === 'string' && body.signature_png_base64) {
    data.signature_url = `data:image/png;base64,${body.signature_png_base64}`
  }
  if (Array.isArray(body.photos_base64)) {
    // Substitui lista de fotos extras (mantem assinatura como primeiro item)
    const sigUrl = data.signature_url || stop.signature_url
    const newPhotos = [
      ...(sigUrl ? [sigUrl] : []),
      ...body.photos_base64.map((b: string) => b.startsWith('data:') ? b : `data:image/jpeg;base64,${b}`),
    ]
    data.photo_urls = newPhotos as any
  }
  if (typeof body.payment_method === 'string') data.payment_method = body.payment_method
  if (Number.isFinite(body.payment_amount_cents)) data.payment_amount_cents = Math.round(body.payment_amount_cents)

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo valido pra atualizar' }, { status: 400 })
  }

  // N7 fix (audit pos-fix): defesa em depth contra IDOR no driver-app PWA.
  // Stop já foi resolvido por findFirst com company_id (L86), mas where do
  // update sem company_id permite IDOR caso o findFirst seja refatorado ou
  // bypassado. Driver-app expõe endpoint à internet — paranoia justificada.
  const updated = await prisma.logisticsStop.update({
    where: { id: params.id, company_id: auth.companyId },
    data,
  })

  return NextResponse.json({
    data: {
      id: updated.id,
      updated_fields: Object.keys(data),
    },
  })
}
