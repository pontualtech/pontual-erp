import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

/**
 * GET /api/os/[id]/customer-messages
 *
 * Retorna o ticket ATIVO vinculado a OS (1 por OS, regra da feature) com
 * as ultimas 10 mensagens. Usado pelo painel CustomerMessagesPanel na pagina
 * de detalhe da OS pra atendente ver conversa do cliente sem sair da OS.
 *
 * Se OS nao tem ticket aberto, retorna { ticket: null, messages: [] }.
 *
 * Feature 2026-05-12 (passo 6/9 Fase 1).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Valida OS pertence a empresa do usuario
    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true },
    })
    if (!os) return error('OS nao encontrada', 404)

    // 1 ticket por OS (ABERTO ou EM_ANDAMENTO ou RESOLVIDO).
    // FECHADO nao volta — encerrado formal.
    const ticket = await prisma.ticket.findFirst({
      where: {
        company_id: user.companyId,
        service_order_id: os.id,
        deleted_at: null,
        status: { in: ['ABERTO', 'EM_ANDAMENTO', 'RESOLVIDO'] },
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        ticket_number: true,
        subject: true,
        status: true,
        priority: true,
        created_at: true,
        updated_at: true,
      },
    })

    if (!ticket) {
      return success({ ticket: null, messages: [] })
    }

    const messages = await prisma.ticketMessage.findMany({
      where: { ticket_id: ticket.id, is_internal: false },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: {
        id: true,
        message: true,
        sender_type: true,
        sender_name: true,
        created_at: true,
      },
    })

    return success({
      ticket,
      // inverte pra ordem cronologica (UI exibe top-down)
      messages: messages.reverse(),
    })
  } catch (err) {
    return handleError(err)
  }
}
