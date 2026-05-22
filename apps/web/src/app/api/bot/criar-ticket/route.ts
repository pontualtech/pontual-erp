import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../_lib/auth'
import { botSuccess, botError } from '../_lib/response'

/**
 * POST /api/bot/criar-ticket
 *
 * Cria um ticket interno pra atendentes humanos. Usado pelo bot quando
 * detecta cliente cobrando atraso (regra 13 do prompt-injection): bot
 * dispara escalation -> ticket aberto na fila pros atendentes pegarem.
 *
 * Decisao Karlao 2026-05-07: cliente cobrando atraso -> bot promete
 * "notificar laboratorio", muda priority da OS pra HIGH/URGENT, e abre
 * um TICKET pros atendentes priorizarem internamente. Sem assigned_to
 * — atendentes pegam da fila ABERTO.
 *
 * Auth: X-Bot-Key header (mesmo padrao dos outros endpoints /api/bot/*)
 */
export async function POST(req: NextRequest) {
  try {
    const auth = authenticateBot(req)
    if (auth instanceof NextResponse) return auth

    const body = await req.json()
    const { subject, description, priority, category, service_order_id, customer_message } = body

    if (!subject?.trim()) return botError('Campo "subject" e obrigatorio')

    // Mensagem ORIGINAL do cliente (vinda do WhatsApp via Chatwoot). Quando
    // presente, e gravada como TicketMessage sender_type=CLIENTE pra operador
    // ver no OsTicketsPanel o que o cliente realmente escreveu — nao so o
    // resumo do bot. Trim + cap defensivo.
    const customerMessage = customer_message
      ? String(customer_message).trim().slice(0, 5000)
      : null

    // Audit 14 fix: IDOR — service_order_id era aceito sem validar tenant.
    // Bot autenticado da empresa X poderia anexar ticket a uma OS da
    // empresa Y se conseguisse adivinhar o UUID. Validar agora.
    if (service_order_id) {
      const osExists = await prisma.serviceOrder.findFirst({
        where: { id: service_order_id, company_id: auth.companyId, deleted_at: null },
        select: { id: true },
      })
      if (!osExists) return botError('service_order_id nao pertence ao tenant', 403)
    }

    // 2026-05-21: dedup — se ja existe ticket BOT aberto pra mesma OS, NAO cria
    // outro. Append uma TicketMessage no existente e retorna ele. Antes do fix
    // caso OS-60615 tinha 2 tickets BOT criados em 1min ("Cliente cobrando atraso"
    // + "URGENTE — Cliente insiste em cobrar atraso") = poluicao na fila.
    if (service_order_id) {
      const existingBotTicket = await prisma.ticket.findFirst({
        where: {
          company_id: auth.companyId,
          service_order_id,
          source: 'BOT',
          status: { not: 'FECHADO' },
          deleted_at: null,
        },
        orderBy: { created_at: 'desc' },
        select: { id: true, ticket_number: true, priority: true, subject: true },
      })
      if (existingBotTicket) {
        // Eleva priority se a nova chamada e mais urgente (URGENT > HIGH > NORMAL)
        const priorityRank: Record<string, number> = { NORMAL: 0, HIGH: 1, URGENT: 2 }
        const newRank = priorityRank[priority || 'NORMAL'] ?? 0
        const curRank = priorityRank[existingBotTicket.priority || 'NORMAL'] ?? 0
        const updatedPriority = newRank > curRank ? priority : existingBotTicket.priority
        await prisma.ticket.update({
          where: { id: existingBotTicket.id },
          data: { priority: updatedPriority, updated_at: new Date() },
        })
        // 2026-05-22: gravar mensagem ORIGINAL do cliente antes do summary do bot
        // pra operador ver no painel o que o cliente escreveu (nao so observacao).
        if (customerMessage) {
          await prisma.ticketMessage.create({
            data: {
              company_id: auth.companyId,
              ticket_id: existingBotTicket.id,
              message: customerMessage,
              sender_type: 'CLIENTE',
              sender_id: null,
              sender_name: 'Cliente',
              is_internal: false,
            },
          })
        }
        await prisma.ticketMessage.create({
          data: {
            company_id: auth.companyId,
            ticket_id: existingBotTicket.id,
            message: `[BOT] ${String(subject).trim()}${description ? '\n\n' + String(description).trim() : ''}`,
            sender_type: 'BOT',
            sender_id: null,
            sender_name: 'Bot',
            is_internal: true,
          },
        })
        return botSuccess({
          ticket_id: existingBotTicket.id,
          ticket_number: existingBotTicket.ticket_number,
          priority: updatedPriority,
          message: `Ticket #${existingBotTicket.ticket_number} reaproveitado (dedup)`,
          deduplicated: true,
        })
      }
    }

    // Auto-increment ticket_number per company (mesmo padrao do POST /api/tickets)
    const lastTicket = await prisma.ticket.findFirst({
      where: { company_id: auth.companyId },
      orderBy: { ticket_number: 'desc' },
      select: { ticket_number: true },
    })

    const ticket = await prisma.ticket.create({
      data: {
        company_id: auth.companyId,
        ticket_number: (lastTicket?.ticket_number || 0) + 1,
        subject: String(subject).trim().slice(0, 200),
        description: description ? String(description).trim() : null,
        priority: priority || 'NORMAL', // NORMAL/HIGH/URGENT
        category: category || null,
        source: 'BOT', // marca origem como bot pra filtros
        customer_id: null,
        service_order_id: service_order_id || null,
        assigned_to: null, // fila aberta, qualquer atendente pega
        created_by: null, // sem user — criado por bot
        created_by_type: 'BOT',
        status: 'ABERTO',
      },
    })

    // 2026-05-22: gravar mensagem ORIGINAL do cliente + observacao do bot
    // como TicketMessage pra aparecer no OsTicketsPanel (last_message + count).
    // Antes, ticket BOT ficava 0 msg e operador so via subject sem o que
    // o cliente realmente escreveu.
    if (customerMessage) {
      await prisma.ticketMessage.create({
        data: {
          company_id: auth.companyId,
          ticket_id: ticket.id,
          message: customerMessage,
          sender_type: 'CLIENTE',
          sender_id: null,
          sender_name: 'Cliente',
          is_internal: false,
        },
      })
    }
    if (description) {
      await prisma.ticketMessage.create({
        data: {
          company_id: auth.companyId,
          ticket_id: ticket.id,
          message: `[BOT] ${String(description).trim()}`,
          sender_type: 'BOT',
          sender_id: null,
          sender_name: 'Bot',
          is_internal: true,
        },
      })
    }

    return botSuccess({
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
      priority: ticket.priority,
      message: `Ticket #${ticket.ticket_number} aberto`,
    })
  } catch (err: any) {
    console.error('[/api/bot/criar-ticket] error:', err)
    return botError('Falha ao criar ticket: ' + (err.message || 'desconhecido'), 500)
  }
}
