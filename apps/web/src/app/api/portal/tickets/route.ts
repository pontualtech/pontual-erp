import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

export async function GET(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(50, Math.max(1, Number(url.get('limit') || '20')))

    const where = {
      company_id: portalUser.company_id,
      customer_id: portalUser.customer_id,
      deleted_at: null,
    }

    const [data, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          service_orders: {
            select: { os_number: true, equipment_type: true },
          },
        },
      }),
      prisma.ticket.count({ where }),
    ])

    return NextResponse.json({
      data: data.map(t => ({
        id: t.id,
        ticket_number: t.ticket_number,
        subject: t.subject,
        description: t.description,
        status: t.status,
        priority: t.priority,
        category: t.category,
        service_order: t.service_orders
          ? { os_number: t.service_orders.os_number, equipment_type: t.service_orders.equipment_type }
          : null,
        created_at: t.created_at,
        updated_at: t.updated_at,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err) {
    console.error('[Portal Tickets List Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { subject, description, service_order_id } = await req.json()

    if (!subject?.trim()) {
      return NextResponse.json({ error: 'Assunto e obrigatorio' }, { status: 400 })
    }

    // Gerar proximo numero de ticket
    const lastTicket = await prisma.ticket.findFirst({
      where: { company_id: portalUser.company_id },
      orderBy: { ticket_number: 'desc' },
      select: { ticket_number: true },
    })

    const ticketNumber = (lastTicket?.ticket_number || 0) + 1

    // Se informou OS, verificar que pertence ao cliente
    if (service_order_id) {
      const os = await prisma.serviceOrder.findFirst({
        where: {
          id: service_order_id,
          company_id: portalUser.company_id,
          customer_id: portalUser.customer_id,
          deleted_at: null,
        },
      })
      if (!os) {
        return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
      }
    }

    const ticket = await prisma.ticket.create({
      data: {
        company_id: portalUser.company_id,
        ticket_number: ticketNumber,
        subject: subject.trim(),
        description: description?.trim() || null,
        status: 'ABERTO',
        priority: 'NORMAL',
        source: 'CLIENTE',
        customer_id: portalUser.customer_id,
        service_order_id: service_order_id || null,
        created_by: portalUser.customer_id,
        created_by_type: 'CLIENTE',
      },
    })

    return NextResponse.json({
      data: {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        message: 'Ticket criado com sucesso!',
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[Portal Ticket Create Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
