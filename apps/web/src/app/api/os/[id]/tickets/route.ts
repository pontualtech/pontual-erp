// GET /api/os/[id]/tickets
//
// Lista todos os tickets vinculados a uma OS (qualquer source).
// Usado pelo painel OsTicketsPanel inline na tela de detalhe da OS.
// Cada ticket vem com sua ultima mensagem + count pra render compacto.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Confirma OS pertence ao tenant (defesa IDOR mesmo com requirePermission)
    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true },
    })
    if (!os) return error('OS nao encontrada', 404)

    const tickets = await prisma.ticket.findMany({
      where: {
        service_order_id: params.id,
        company_id: user.companyId,
        deleted_at: null,
      },
      orderBy: { updated_at: 'desc' },
      include: {
        ticket_messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    })

    // Conta total de mensagens por ticket (so ultima vem no include — count separado)
    const counts = await prisma.ticketMessage.groupBy({
      by: ['ticket_id'],
      where: { ticket_id: { in: tickets.map(t => t.id) } },
      _count: { _all: true },
    })
    const countMap = new Map(counts.map(c => [c.ticket_id, c._count._all]))

    // Mensagem ORIGINAL do cliente (1a msg sender_type=CLIENTE em cada ticket).
    // Permite mostrar no card colapsado "o que o cliente realmente escreveu",
    // mesmo que a ultima mensagem ja seja resposta do bot/atendente.
    const ticketIds = tickets.map((t: { id: string }) => t.id)
    const customerMsgs = ticketIds.length
      ? await prisma.ticketMessage.findMany({
          where: { ticket_id: { in: ticketIds }, sender_type: 'CLIENTE' },
          orderBy: { created_at: 'asc' },
          select: { ticket_id: true, message: true, created_at: true },
        })
      : []
    const customerMap = new Map<string, { message: string; created_at: Date | null }>()
    for (const m of customerMsgs) {
      if (!customerMap.has(m.ticket_id)) {
        customerMap.set(m.ticket_id, { message: m.message, created_at: m.created_at })
      }
    }

    const payload = tickets.map(t => {
      const cm = customerMap.get(t.id)
      return {
        id: t.id,
        ticket_number: t.ticket_number,
        subject: t.subject,
        status: t.status,
        source: t.source,
        created_at: t.created_at,
        updated_at: t.updated_at,
        last_message: t.ticket_messages[0]
          ? {
              message: t.ticket_messages[0].message,
              sender_type: t.ticket_messages[0].sender_type,
              sender_name: t.ticket_messages[0].sender_name,
              created_at: t.ticket_messages[0].created_at,
              is_internal: t.ticket_messages[0].is_internal,
            }
          : null,
        customer_message: cm
          ? { message: cm.message, created_at: cm.created_at }
          : null,
        message_count: countMap.get(t.id) || 0,
      }
    })

    return success({ tickets: payload })
  } catch (err) {
    return handleError(err)
  }
}
