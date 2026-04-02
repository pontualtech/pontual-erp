import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, Number(url.get('limit') || '20')))
    const search = url.get('search') || ''
    const status = url.get('status') || null
    const priority = url.get('priority') || null
    const source = url.get('source') || null
    const assignedTo = url.get('assigned_to') || null

    const where: any = {
      company_id: user.companyId,
      deleted_at: null,
    }

    if (status) where.status = status
    if (priority) where.priority = priority
    if (source) where.source = source
    if (assignedTo) where.assigned_to = assignedTo
    if (search) {
      where.OR = [
        { ticket_number: isNaN(Number(search)) ? undefined : Number(search) },
        { subject: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ].filter(Boolean)
    }

    const [data, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          customers: { select: { id: true, legal_name: true } },
          service_orders: { select: { id: true, os_number: true } },
          ticket_messages: { select: { id: true } },
        },
      }),
      prisma.ticket.count({ where }),
    ])

    // Fetch assigned user names
    const assignedIds = data
      .map(t => t.assigned_to)
      .filter((id): id is string => !!id)
    const assignedUsers = assignedIds.length > 0
      ? await prisma.userProfile.findMany({
          where: { id: { in: assignedIds } },
          select: { id: true, name: true },
        })
      : []
    const userMap = Object.fromEntries(assignedUsers.map(u => [u.id, u.name]))

    const enriched = data.map(t => ({
      ...t,
      assigned_user_name: t.assigned_to ? userMap[t.assigned_to] || null : null,
      customer_name: t.customers?.legal_name || null,
      os_number: t.service_orders?.os_number || null,
      os_id: t.service_orders?.id || null,
      message_count: t.ticket_messages.length,
      service_orders: undefined,
      ticket_messages: undefined,
    }))

    return paginated(enriched, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()

    if (!body.subject?.trim()) return error('Assunto e obrigatorio')

    // Auto-increment ticket_number per company
    const lastTicket = await prisma.ticket.findFirst({
      where: { company_id: user.companyId },
      orderBy: { ticket_number: 'desc' },
      select: { ticket_number: true },
    })

    const ticket = await prisma.ticket.create({
      data: {
        company_id: user.companyId,
        ticket_number: (lastTicket?.ticket_number || 0) + 1,
        subject: body.subject.trim(),
        description: body.description?.trim() || null,
        priority: body.priority || 'NORMAL',
        category: body.category || null,
        source: body.source || 'INTERNO',
        customer_id: body.customer_id || null,
        service_order_id: body.service_order_id || null,
        assigned_to: body.assigned_to || user.id,
        created_by: user.id,
        created_by_type: 'FUNCIONARIO',
        status: 'ABERTO',
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'tickets',
      action: 'create',
      entityId: ticket.id,
      newValue: body,
    })

    return success(ticket, 201)
  } catch (err) {
    return handleError(err)
  }
}
