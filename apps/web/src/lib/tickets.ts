import { prisma } from '@pontual/db'

/**
 * Garante 1 Ticket "ativo" por Service Order.
 *
 * Reutiliza ticket existente que ainda não foi FECHADO (ABERTO,
 * EM_ANDAMENTO ou RESOLVIDO). Se RESOLVIDO, reabre como ABERTO porque
 * cliente está mandando msg nova depois de "resolução" anterior.
 *
 * Apenas FECHADO força criação de ticket novo (atendente decidiu encerrar
 * formalmente — qualquer msg posterior é uma nova interação).
 *
 * Idempotente: 5 chamadas seguidas = 1 ticket só.
 *
 * Feature 2026-05-12 (passo 2/9 Fase 1): canal cliente↔atendente vinculado
 * à OS, com mensagens do portal aparecendo no dashboard.
 */
export async function ensureTicketForOS(params: {
  companyId: string
  serviceOrderId: string
  customerId: string | null
  subject?: string
  source?: string
}) {
  const { companyId, serviceOrderId, customerId, subject, source } = params

  // 1. Procura ticket ainda ativo da OS (incluindo RESOLVIDO pra reabrir)
  const existing = await prisma.ticket.findFirst({
    where: {
      company_id: companyId,
      service_order_id: serviceOrderId,
      deleted_at: null,
      status: { in: ['ABERTO', 'EM_ANDAMENTO', 'RESOLVIDO'] },
    },
    orderBy: { created_at: 'desc' },
  })

  if (existing) {
    // Se RESOLVIDO, reabre — cliente voltou com algo novo
    if (existing.status === 'RESOLVIDO') {
      return prisma.ticket.update({
        where: { id: existing.id },
        data: { status: 'ABERTO', updated_at: new Date() },
      })
    }
    return existing
  }

  // 2. Cria novo — copia padrão de auto-increment de bot/criar-ticket
  const lastTicket = await prisma.ticket.findFirst({
    where: { company_id: companyId },
    orderBy: { ticket_number: 'desc' },
    select: { ticket_number: true },
  })

  // Pega número da OS pra subject default
  const os = await prisma.serviceOrder.findUnique({
    where: { id: serviceOrderId },
    select: { os_number: true },
  })

  return prisma.ticket.create({
    data: {
      company_id: companyId,
      ticket_number: (lastTicket?.ticket_number || 0) + 1,
      subject: subject?.trim().slice(0, 200) || `Conversa OS #${os?.os_number ?? '?'}`,
      service_order_id: serviceOrderId,
      customer_id: customerId,
      source: source || 'PORTAL',
      status: 'ABERTO',
      created_by_type: 'CLIENTE',
    },
  })
}

/**
 * Adiciona mensagem do CLIENTE no ticket. Atualiza `updated_at` do ticket
 * pra ele subir na lista do dashboard (mensagem recente).
 */
export async function addCustomerMessageToTicket(params: {
  ticketId: string
  companyId: string
  message: string
  customerName?: string | null
}) {
  const { ticketId, companyId, message, customerName } = params

  const msg = await prisma.ticketMessage.create({
    data: {
      company_id: companyId,
      ticket_id: ticketId,
      message: message.trim(),
      sender_type: 'CLIENTE',
      sender_name: customerName?.trim() || 'Cliente',
      is_internal: false,
    },
  })

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { updated_at: new Date() },
  })

  return msg
}
