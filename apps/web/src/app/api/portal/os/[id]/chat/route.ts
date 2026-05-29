// GET/POST /api/portal/os/[id]/chat
//
// Cliente vê/envia mensagens do chat da OS pelo portal.
// Reusa o mesmo Ticket "CHAT_OS" criado pelo admin (ou cria se não existir).
// POST de cliente: TicketMessage sender_type=CLIENTE — não dispara WhatsApp
// (cliente JÁ está na conversa, basta atendente ver no admin).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { isAllowedOrigin } from '@/lib/csrf-origin'
import { isImprimitechHandoffStatus } from '@/lib/imprimitech-handoff'

type Params = { params: { id: string } }

// Mesmo helper do admin — duplicado pra evitar dependencia cruzada.
async function getOrCreateOsChatTicket(osId: string, companyId: string, customerId: string | null) {
  let ticket = await prisma.ticket.findFirst({
    where: { service_order_id: osId, company_id: companyId, deleted_at: null, source: 'CHAT_OS' },
    orderBy: { created_at: 'desc' },
  })
  if (ticket) return ticket

  const os = await prisma.serviceOrder.findFirst({
    where: { id: osId, company_id: companyId, customer_id: customerId || undefined, deleted_at: null },
    select: { id: true, os_number: true, customer_id: true },
  })
  if (!os) throw new Error('OS nao encontrada')

  const lastTicket = await prisma.ticket.findFirst({
    where: { company_id: companyId },
    orderBy: { ticket_number: 'desc' },
    select: { ticket_number: true },
  })
  ticket = await prisma.ticket.create({
    data: {
      company_id: companyId,
      ticket_number: (lastTicket?.ticket_number || 0) + 1,
      subject: `Chat OS-${String(os.os_number).padStart(4, '0')}`,
      description: 'Conversa iniciada pelo cliente via portal.',
      status: 'ABERTO',
      priority: 'NORMAL',
      source: 'CHAT_OS',
      customer_id: os.customer_id,
      service_order_id: os.id,
      created_by_type: 'CLIENTE',
    },
  })
  return ticket
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      select: { id: true, module_statuses: { select: { name: true } } },
    })
    if (!os) return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })

    // Wave 1.1 audit C2: gate handoff — cliente não vê histórico de chat
    // de OS já transferida pra Imprimitech (a comunicação segue na IMP).
    if (isImprimitechHandoffStatus(os.module_statuses?.name)) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    const ticket = await getOrCreateOsChatTicket(params.id, portalUser.company_id, portalUser.customer_id)
    const messages = await prisma.ticketMessage.findMany({
      where: { ticket_id: ticket.id, is_internal: false }, // cliente NAO ve mensagens internas
      orderBy: { created_at: 'asc' },
    })
    return NextResponse.json({ data: { ticket_id: ticket.id, messages } })
  } catch (err) {
    console.error('[portal/os/chat GET]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!isAllowedOrigin(req)) {
      return NextResponse.json({ error: 'Origem nao autorizada' }, { status: 403 })
    }
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const text = (body.message || '').trim()
    if (!text) return NextResponse.json({ error: 'Mensagem e obrigatoria' }, { status: 400 })
    if (text.length > 5000) return NextResponse.json({ error: 'Mensagem muito longa (max 5000)' }, { status: 400 })

    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      include: {
        customers: { select: { legal_name: true } },
        module_statuses: { select: { name: true } },
      },
    })
    if (!os) return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })

    // Wave 1.1 audit C2: gate handoff — cliente não cria mensagem nova
    // em OS já transferida. Sem este gate atendente PT recebia mensagem
    // que devia ser pra Aline (Imprimitech).
    if (isImprimitechHandoffStatus(os.module_statuses?.name)) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    const ticket = await getOrCreateOsChatTicket(params.id, portalUser.company_id, portalUser.customer_id)

    const message = await prisma.ticketMessage.create({
      data: {
        company_id: portalUser.company_id,
        ticket_id: ticket.id,
        message: text,
        sender_type: 'CLIENTE',
        sender_id: portalUser.customer_id,
        sender_name: os.customers?.legal_name || 'Cliente',
        is_internal: false,
      },
    })

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { updated_at: new Date(), status: 'ABERTO' }, // reabre se estava resolvido
    })

    return NextResponse.json({ data: { ticket_id: ticket.id, message } }, { status: 201 })
  } catch (err) {
    console.error('[portal/os/chat POST]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
