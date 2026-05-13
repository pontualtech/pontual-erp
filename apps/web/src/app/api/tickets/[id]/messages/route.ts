import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { sendWhatsAppCloud } from '@/lib/whatsapp/cloud-api'
import { buildMagicLink } from '@/lib/portal-magic-url'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Verify ticket belongs to company
    const ticket = await prisma.ticket.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true },
    })
    if (!ticket) return error('Ticket nao encontrado', 404)

    const messages = await prisma.ticketMessage.findMany({
      where: { ticket_id: params.id },
      orderBy: { created_at: 'asc' },
    })

    return success(messages)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    // Verify ticket belongs to company. Inclui customer + OS pra eventual
    // notificacao WhatsApp (passo 7/9 feature 2026-05-12).
    const ticket = await prisma.ticket.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        customers: { select: { id: true, mobile: true, phone: true, legal_name: true } },
        service_orders: { select: { id: true, os_number: true } },
        companies: { select: { slug: true } },
      },
    })
    if (!ticket) return error('Ticket nao encontrado', 404)

    const body = await req.json()
    if (!body.message?.trim()) return error('Mensagem e obrigatoria')

    const isInternal = body.is_internal === true
    const message = await prisma.ticketMessage.create({
      data: {
        company_id: ticket.company_id,
        ticket_id: params.id,
        message: body.message.trim(),
        sender_type: 'FUNCIONARIO',
        sender_id: user.id,
        sender_name: user.name,
        is_internal: isInternal,
      },
    })

    // Update ticket updated_at
    await prisma.ticket.update({
      where: { id: params.id },
      data: { updated_at: new Date() },
    })

    // Hook 2026-05-12 (passo 7/9 Fase 1): notifica cliente via WhatsApp
    // quando atendente posta resposta publica. Cliente abre o portal e ve
    // a resposta no auto-refresh. Graceful: erra -> log, nao quebra POST.
    if (!isInternal && ticket.customers && ticket.companies) {
      const customerPhone = (ticket.customers.mobile || ticket.customers.phone || '').replace(/\D/g, '')
      if (customerPhone) {
        try {
          const { url } = buildMagicLink({
            customerId: ticket.customers.id,
            companyId: ticket.company_id,
            slug: ticket.companies.slug,
            redirectPath: `/portal/${ticket.companies.slug}/tickets/${ticket.id}`,
          })
          const osLabel = ticket.service_orders ? `OS #${ticket.service_orders.os_number}` : `seu atendimento`
          const text = `Voce tem uma nova resposta sobre ${osLabel}. Veja no portal:\n${url}`
          // sendWhatsAppCloud retorna { success, error? } e nao joga exception
          sendWhatsAppCloud(ticket.company_id, customerPhone, text)
            .then(r => {
              if (!r.success) console.warn('[ticket-msg-hook] WA falhou:', r.error)
            })
            .catch(e => console.warn('[ticket-msg-hook] WA exception:', e instanceof Error ? e.message : e))
        } catch (e) {
          console.warn('[ticket-msg-hook] erro construindo magic-link:', e instanceof Error ? e.message : e)
        }
      }
    }

    return success(message, 201)
  } catch (err) {
    return handleError(err)
  }
}
