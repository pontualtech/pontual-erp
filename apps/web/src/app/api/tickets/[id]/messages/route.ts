import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

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

    // Verify ticket belongs to company
    const ticket = await prisma.ticket.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true, company_id: true },
    })
    if (!ticket) return error('Ticket nao encontrado', 404)

    const body = await req.json()
    if (!body.message?.trim()) return error('Mensagem e obrigatoria')

    const message = await prisma.ticketMessage.create({
      data: {
        company_id: ticket.company_id,
        ticket_id: params.id,
        message: body.message.trim(),
        sender_type: 'FUNCIONARIO',
        sender_id: user.id,
        sender_name: user.name,
        is_internal: body.is_internal === true,
      },
    })

    // Update ticket updated_at
    await prisma.ticket.update({
      where: { id: params.id },
      data: { updated_at: new Date() },
    })

    return success(message, 201)
  } catch (err) {
    return handleError(err)
  }
}
