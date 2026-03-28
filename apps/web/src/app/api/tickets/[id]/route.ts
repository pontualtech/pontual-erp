import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const ticket = await prisma.ticket.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        customers: { select: { id: true, legal_name: true, phone: true } },
        service_orders: { select: { id: true, os_number: true, equipment_type: true } },
        ticket_messages: { orderBy: { created_at: 'asc' } },
      },
    })

    if (!ticket) return error('Ticket nao encontrado', 404)

    // Fetch assigned user and creator names
    const userIds = [ticket.assigned_to, ticket.created_by].filter((id): id is string => !!id)
    const users = userIds.length > 0
      ? await prisma.userProfile.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]))

    return success({
      ...ticket,
      assigned_user_name: ticket.assigned_to ? userMap[ticket.assigned_to] || null : null,
      created_by_name: ticket.created_by ? userMap[ticket.created_by] || null : null,
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.ticket.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Ticket nao encontrado', 404)

    const body = await req.json()

    // Only allow specific fields to be updated
    const data: any = {}
    if (body.status !== undefined) {
      data.status = body.status
      if (body.status === 'FECHADO' || body.status === 'RESOLVIDO') {
        data.closed_at = new Date()
      }
    }
    if (body.priority !== undefined) data.priority = body.priority
    if (body.assigned_to !== undefined) data.assigned_to = body.assigned_to
    if (body.category !== undefined) data.category = body.category
    data.updated_at = new Date()

    const ticket = await prisma.ticket.update({
      where: { id: params.id },
      data,
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'tickets',
      action: 'update',
      entityId: ticket.id,
      oldValue: existing as any,
      newValue: body,
    })

    return success(ticket)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.ticket.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Ticket nao encontrado', 404)

    await prisma.ticket.update({
      where: { id: params.id },
      data: { deleted_at: new Date() },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'tickets',
      action: 'delete',
      entityId: params.id,
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
