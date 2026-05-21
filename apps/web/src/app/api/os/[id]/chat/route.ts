// GET/POST /api/os/[id]/chat
//
// Chat inline da OS (admin). Reutiliza modelo Ticket existente:
// - 1 Ticket por OS (subject "Chat OS-XXXX") criado on-demand
// - TicketMessage armazena mensagens
// - POST dispara WhatsApp pro cliente com magic link pro portal
//
// Reusa: lib auth, sendWhatsAppCloud, buildMagicLink — mesmo padrao do
// /api/tickets/[id]/messages que ja existe e funciona desde 2026-05-12.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { sendWhatsAppCloud } from '@/lib/whatsapp/cloud-api'
import { buildMagicLink } from '@/lib/portal-magic-url'

type Params = { params: { id: string } }

// Helper: encontra ou cria o ticket de chat da OS.
async function getOrCreateOsChatTicket(osId: string, companyId: string) {
  // Tenta ticket existente vinculado a OS (source=CHAT_OS pra distinguir
  // de tickets criados por bot/escalation que tambem usam service_order_id)
  let ticket = await prisma.ticket.findFirst({
    where: {
      service_order_id: osId,
      company_id: companyId,
      deleted_at: null,
      source: 'CHAT_OS',
    },
    orderBy: { created_at: 'desc' },
  })
  if (ticket) return ticket

  // Carrega OS pra montar subject + linkar customer
  const os = await prisma.serviceOrder.findFirst({
    where: { id: osId, company_id: companyId, deleted_at: null },
    select: { id: true, os_number: true, customer_id: true },
  })
  if (!os) throw new Error('OS nao encontrada')

  // Auto-increment ticket_number per company
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
      description: 'Conversa inline da OS no admin/portal.',
      status: 'ABERTO',
      priority: 'NORMAL',
      source: 'CHAT_OS',
      customer_id: os.customer_id,
      service_order_id: os.id,
      created_by_type: 'FUNCIONARIO',
    },
  })
  return ticket
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Confirma OS pertence ao tenant antes de criar/buscar ticket (defesa
    // contra IDOR mesmo com requirePermission)
    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true },
    })
    if (!os) return error('OS nao encontrada', 404)

    const ticket = await getOrCreateOsChatTicket(params.id, user.companyId)
    const messages = await prisma.ticketMessage.findMany({
      where: { ticket_id: ticket.id },
      orderBy: { created_at: 'asc' },
    })
    return success({ ticket_id: ticket.id, messages })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const text = (body.message || '').trim()
    if (!text) return error('Mensagem e obrigatoria')

    // Carrega OS com customer + company pra disparo WhatsApp
    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        customers: { select: { id: true, mobile: true, phone: true, legal_name: true } },
        companies: { select: { slug: true } },
      },
    })
    if (!os) return error('OS nao encontrada', 404)

    const ticket = await getOrCreateOsChatTicket(params.id, user.companyId)

    const message = await prisma.ticketMessage.create({
      data: {
        company_id: user.companyId,
        ticket_id: ticket.id,
        message: text,
        sender_type: 'FUNCIONARIO',
        sender_id: user.id,
        sender_name: user.name,
        is_internal: false,
      },
    })

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { updated_at: new Date() },
    })

    // Dispara WhatsApp pra cliente — mesmo padrao do /api/tickets/[id]/messages.
    // 2026-05-21: encurta magic-link via /lib/short-link (mesmo padrao bot Marta).
    // URL fica `portal.X.com.br/s/aBc123` em vez de string de 350+ chars.
    if (os.customers && os.companies) {
      const customerPhone = (os.customers.mobile || os.customers.phone || '').replace(/\D/g, '')
      if (customerPhone) {
        try {
          const { url } = buildMagicLink({
            customerId: os.customers.id,
            companyId: user.companyId,
            slug: os.companies.slug,
            osId: os.id,
          })
          let displayUrl = url
          try {
            const { shortenUrl } = await import('@/lib/short-link')
            displayUrl = await shortenUrl(url, user.companyId, os.customers.id)
          } catch (e) {
            console.warn('[os-chat] shorten falhou, usando URL completa:', e instanceof Error ? e.message : e)
          }
          const osLabel = `OS #${String(os.os_number).padStart(4, '0')}`
          const waText = `Voce tem uma nova mensagem sobre ${osLabel}:\n\n"${text.slice(0, 300)}${text.length > 300 ? '...' : ''}"\n\nVer no portal:\n${displayUrl}`
          sendWhatsAppCloud(user.companyId, customerPhone, waText)
            .then(r => { if (!r.success) console.warn('[os-chat] WA falhou:', r.error) })
            .catch(e => console.warn('[os-chat] WA exception:', e instanceof Error ? e.message : e))
        } catch (e) {
          console.warn('[os-chat] erro magic-link:', e instanceof Error ? e.message : e)
        }
      }
    }

    return success({ ticket_id: ticket.id, message }, 201)
  } catch (err) {
    return handleError(err)
  }
}
