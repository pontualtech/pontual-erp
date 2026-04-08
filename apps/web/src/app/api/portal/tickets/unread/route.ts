import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

export async function GET(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    // Count tickets with messages from non-client senders since last client message
    // Simple approach: count open tickets that have a non-client message newer than the last client message
    const tickets = await prisma.ticket.findMany({
      where: {
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
        status: { notIn: ['FECHADO', 'RESOLVIDO'] },
      },
      select: {
        id: true,
        ticket_messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { sender_type: true },
        },
      },
    })

    // A ticket has unread messages if the last message is from staff (not client)
    const unread = tickets.filter(t =>
      t.ticket_messages.length > 0 &&
      t.ticket_messages[0].sender_type !== 'CLIENTE'
    ).length

    return NextResponse.json({ data: { unread } })
  } catch (err) {
    console.error('[Portal Tickets Unread Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
