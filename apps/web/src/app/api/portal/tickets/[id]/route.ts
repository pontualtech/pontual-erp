import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      include: {
        service_orders: {
          select: { os_number: true, equipment_type: true },
        },
        ticket_messages: {
          where: {
            is_internal: { not: true }, // NUNCA mostrar mensagens internas
          },
          orderBy: { created_at: 'asc' },
          select: {
            id: true,
            message: true,
            sender_type: true,
            sender_name: true,
            created_at: true,
          },
        },
      },
    })

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket nao encontrado' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        subject: ticket.subject,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        service_order: ticket.service_orders
          ? { os_number: ticket.service_orders.os_number, equipment_type: ticket.service_orders.equipment_type }
          : null,
        messages: ticket.ticket_messages,
        created_at: ticket.created_at,
        updated_at: ticket.updated_at,
        closed_at: ticket.closed_at,
      },
    })
  } catch (err) {
    console.error('[Portal Ticket Detail Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { message } = await req.json()

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Mensagem e obrigatoria' }, { status: 400 })
    }

    // Verificar que o ticket pertence ao cliente
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
    })

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket nao encontrado' }, { status: 404 })
    }

    if (ticket.status === 'FECHADO') {
      return NextResponse.json({ error: 'Ticket esta fechado' }, { status: 400 })
    }

    // Buscar nome do cliente
    const customer = await prisma.customer.findUnique({
      where: { id: portalUser.customer_id },
      select: { legal_name: true },
    })

    const ticketMessage = await prisma.ticketMessage.create({
      data: {
        company_id: portalUser.company_id,
        ticket_id: ticket.id,
        message: message.trim(),
        sender_type: 'CLIENTE',
        sender_id: portalUser.customer_id,
        sender_name: customer?.legal_name || 'Cliente',
        is_internal: false,
      },
    })

    // Reabrir ticket se estava em "AGUARDANDO_CLIENTE"
    if (ticket.status === 'AGUARDANDO_CLIENTE') {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'ABERTO', updated_at: new Date() },
      })
    }

    return NextResponse.json({
      data: {
        id: ticketMessage.id,
        message: ticketMessage.message,
        sender_type: ticketMessage.sender_type,
        sender_name: ticketMessage.sender_name,
        created_at: ticketMessage.created_at,
      },
    })
  } catch (err) {
    console.error('[Portal Ticket Message Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
