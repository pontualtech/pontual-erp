import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { sendWhatsAppCloud } from '@/lib/whatsapp/cloud-api'
import { rateLimit } from '@/lib/rate-limit'

/**
 * Chat motorista <-> cliente por stop.
 *
 * Canal: ChatMessage.channel = `stop:<stopId>` (reusa tabela existente,
 * sem migration nova). sender_id 'customer' identifica mensagens do
 * cliente (inbound); outros valores sao id do motorista (outbound).
 *
 * GET ?since=ISO  — lista mensagens (polling incremental)
 * POST { message } — motorista envia texto livre ao cliente via WA
 *                    + marca BotConversation como human_takeover=true
 *                    pra pausar a Marta enquanto stop ativo.
 *
 * Permitido apenas se stop ainda ativo (EN_ROUTE ou ARRIVED). Apos
 * COMPLETED/FAILED a conversa fica read-only pelo GET.
 */

function channelFor(stopId: string) {
  return `stop:${stopId}`
}

const CUSTOMER_SENDER_ID = 'customer'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const stop = await prisma.logisticsStop.findFirst({
    where: { id: params.id, company_id: auth.companyId },
    include: { route: { select: { driver_id: true } } },
    // signature_url/photo_urls sao pesados; exclui do resultado
    // buscando so campos necessarios
  })
  if (!stop) return NextResponse.json({ error: 'Parada nao encontrada' }, { status: 404 })
  if (stop.route.driver_id && stop.route.driver_id !== auth.id && !auth.isSuperAdmin) {
    return NextResponse.json({ error: 'Parada de outro motorista' }, { status: 403 })
  }

  const sinceStr = req.nextUrl.searchParams.get('since')
  const since = sinceStr ? new Date(sinceStr) : null

  const msgs = await prisma.chatMessage.findMany({
    where: {
      company_id: auth.companyId,
      channel: channelFor(stop.id),
      ...(since && !isNaN(since.getTime()) ? { created_at: { gt: since } } : {}),
    },
    orderBy: { created_at: 'asc' },
    take: 200,
  })

  return NextResponse.json({
    data: {
      messages: msgs.map(m => ({
        id: m.id,
        body: m.message,
        from: m.sender_id === CUSTOMER_SENDER_ID ? 'customer' : 'driver',
        sender_name: m.sender_name,
        created_at: m.created_at,
      })),
      // Informa a UI se o stop ainda permite envio de msg
      active: stop.status === 'EN_ROUTE' || stop.status === 'ARRIVED',
      stop_status: stop.status,
    },
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  // Protege contra flood: max 20 msgs/min por stop.
  const rl = rateLimit(`stop-msg:${params.id}`, 20, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Muitas mensagens — aguarde 1 minuto' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const text = String(body.message || '').trim()
  if (!text) return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 })
  if (text.length > 4000) return NextResponse.json({ error: 'Mensagem muito longa (max 4000)' }, { status: 400 })

  const stop = await prisma.logisticsStop.findFirst({
    where: { id: params.id, company_id: auth.companyId },
    include: { route: { select: { driver_id: true } } },
  })
  if (!stop) return NextResponse.json({ error: 'Parada nao encontrada' }, { status: 404 })
  if (stop.route.driver_id && stop.route.driver_id !== auth.id && !auth.isSuperAdmin) {
    return NextResponse.json({ error: 'Parada de outro motorista' }, { status: 403 })
  }
  if (stop.status !== 'EN_ROUTE' && stop.status !== 'ARRIVED') {
    return NextResponse.json({ error: 'Parada nao esta ativa — nao e possivel enviar mensagens' }, { status: 400 })
  }

  // Telefone do cliente (preferencia: OS > fallback pro campo do stop)
  let rawPhone = stop.customer_phone || ''
  if (stop.os_id) {
    const os = await prisma.serviceOrder.findFirst({
      where: { id: stop.os_id, company_id: auth.companyId },
      select: { customers: { select: { mobile: true, phone: true } } },
    })
    rawPhone = os?.customers?.mobile || os?.customers?.phone || rawPhone
  }
  const phone = String(rawPhone).replace(/\D/g, '')
  if (phone.length < 10) {
    return NextResponse.json({ error: 'Cliente sem telefone' }, { status: 400 })
  }
  const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`

  // Envia via WA (Cloud p/ PontualTech, fallback Evolution p/ Imprimitech)
  const waResult = await sendWhatsAppCloud(auth.companyId, normalizedPhone, text)

  // Salva mensagem outbound na tabela (independente de envio ter funcionado,
  // pra motorista ver no historico; se falhou, flag de erro fica no campo
  // sender_name com prefixo '[falhou]')
  const savedName = waResult.success ? auth.name : `[falhou] ${auth.name}`
  const saved = await prisma.chatMessage.create({
    data: {
      company_id: auth.companyId,
      sender_id: auth.id,
      sender_name: savedName,
      message: text,
      channel: channelFor(stop.id),
    },
  })

  // Pausa a Marta pra essa conversa (se existir BotConversation associada
  // ao telefone). Enquanto motorista esta conversando, bot nao interrompe.
  try {
    await prisma.botConversation.updateMany({
      where: {
        company_id: auth.companyId,
        customer_phone: { in: [normalizedPhone, phone] },
      },
      data: { human_takeover: true, step: 'HUMAN' },
    })
  } catch (err) {
    console.warn('[stop-msg] falha ao pausar bot:', err instanceof Error ? err.message : String(err))
  }

  return NextResponse.json({
    data: {
      id: saved.id,
      body: saved.message,
      from: 'driver',
      created_at: saved.created_at,
      whatsapp_sent: waResult.success,
      whatsapp_error: waResult.success ? null : waResult.error,
    },
  })
}
