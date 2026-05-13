import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { ensureTicketForOS, addCustomerMessageToTicket } from '@/lib/tickets'

/**
 * POST /api/portal/ai/escalate
 * Body: { session_id?: string, os_id: string }
 *
 * Cliente conversou com IA e quer falar com atendente humano.
 * Cria/reusa Ticket vinculado à OS, copia a conversa da IA como
 * UMA mensagem do CLIENTE pra atendente ver o contexto inteiro,
 * e dispara um Announcement vinculado ao ticket pro dashboard.
 *
 * Auth: cookie portal (httpOnly).
 *
 * Feature 2026-05-12 (passo 3/9 Fase 1).
 */
export async function POST(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { session_id, os_id } = await req.json().catch(() => ({}))
    if (!os_id) {
      return NextResponse.json({ error: 'os_id obrigatorio' }, { status: 400 })
    }

    // 1. Valida que a OS pertence ao cliente da sessao
    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: os_id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      include: {
        customers: { select: { id: true, legal_name: true } },
      },
    })
    if (!os) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    // 2. Carrega conversa IA (se session_id fornecido). Valida ownership.
    let aiMessages: { role: string; content: string }[] = []
    if (session_id) {
      const session = await prisma.aiChatSession.findFirst({
        where: {
          id: session_id,
          company_id: portalUser.company_id,
          customer_id: portalUser.customer_id,
        },
        include: {
          messages: { orderBy: { created_at: 'asc' } },
        },
      })
      if (session) {
        aiMessages = session.messages.map(m => ({ role: m.role, content: m.content }))
      }
    }

    // 3. Garante 1 ticket por OS
    const ticket = await ensureTicketForOS({
      companyId: portalUser.company_id,
      serviceOrderId: os.id,
      customerId: os.customer_id,
      subject: `Conversa OS #${os.os_number}`,
      source: 'PORTAL',
    })

    // 4. Formata conversa IA como UMA mensagem do cliente (preserva contexto)
    let formattedMessage: string
    if (aiMessages.length > 0) {
      const transcript = aiMessages
        .map(m => {
          const prefix = m.role === 'user' ? '🙋 Cliente' : '🤖 IA'
          return `${prefix}: ${m.content}`
        })
        .join('\n\n')
      formattedMessage = `[Cliente abriu chamado vindo do Suporte IA]\n\n${transcript}\n\n— Cliente pediu falar com atendente.`
    } else {
      formattedMessage = `Cliente clicou em "Falar com atendente" diretamente, sem passar pelo Suporte IA.`
    }

    await addCustomerMessageToTicket({
      ticketId: ticket.id,
      companyId: portalUser.company_id,
      message: formattedMessage,
      customerName: os.customers?.legal_name || null,
    })

    // 5. Aviso pro dashboard apontando pro ticket (ticket_id coluna do passo 1)
    await prisma.announcement.create({
      data: {
        company_id: portalUser.company_id,
        title: `💬 Cliente quer falar — OS #${os.os_number} — ${os.customers?.legal_name || 'Cliente'}`,
        message: aiMessages.length > 0
          ? `Cliente passou pelo Suporte IA mas pediu atendente humano. Veja a conversa completa no ticket.`
          : `Cliente abriu conversa direta sobre a OS #${os.os_number}.`,
        priority: 'IMPORTANTE',
        require_read: false,
        author_name: 'Sistema',
        created_by: 'portal',
        ticket_id: ticket.id,
      },
    })

    return NextResponse.json({
      data: {
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
      },
    })
  } catch (err) {
    console.error('[Portal AI Escalate]', err)
    const msg = err instanceof Error ? err.message : 'Erro ao escalar'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
