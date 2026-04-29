/**
 * GET /api/voip/calls — lista CDR com filtros
 *
 * Query params:
 *   page (default 1)
 *   limit (default 20, max 100)
 *   direction: "inbound" | "outbound"
 *   status: "ringing" | "answered" | "missed" | "busy" | "no_answer" | "failed" | "completed"
 *   customerId
 *   agentUserId
 *   startedFrom / startedTo (ISO date)
 *   search (busca em from_number, to_number, customer.legal_name)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireAuth } from '@/lib/auth'
import { paginated, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, Number(url.get('limit') || '20')))
    const direction = url.get('direction') || undefined
    const status = url.get('status') || undefined
    const customerId = url.get('customerId') || undefined
    const agentUserId = url.get('agentUserId') || undefined
    const startedFrom = url.get('startedFrom')
    const startedTo = url.get('startedTo')
    const search = url.get('search')?.trim() || ''

    const where: any = {
      company_id: user.companyId,
    }
    if (direction) where.direction = direction
    if (status) where.status = status
    if (customerId) where.customer_id = customerId
    if (agentUserId) where.agent_user_id = agentUserId
    if (startedFrom || startedTo) {
      where.started_at = {}
      if (startedFrom) where.started_at.gte = new Date(startedFrom)
      if (startedTo) where.started_at.lte = new Date(startedTo)
    }
    if (search) {
      const digits = search.replace(/\D/g, '')
      where.OR = [
        ...(digits ? [
          { from_number: { contains: digits } },
          { to_number: { contains: digits } },
        ] : []),
        { customers: { legal_name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [items, total] = await Promise.all([
      prisma.voipCall.findMany({
        where,
        orderBy: { started_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customers: {
            select: { id: true, legal_name: true, trade_name: true, mobile: true, phone: true },
          },
          user_profiles: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      prisma.voipCall.count({ where }),
    ])

    return paginated(items, total, page, limit)
  } catch (e) {
    return handleError(e)
  }
}
