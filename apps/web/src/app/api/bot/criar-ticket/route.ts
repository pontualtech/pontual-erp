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
    const { subject, description, priority, category, service_order_id } = body

    if (!subject?.trim()) return botError('Campo "subject" e obrigatorio')

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
