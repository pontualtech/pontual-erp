import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { paginated, handleError } from '@/lib/api-response'

/**
 * GET /api/admin/errors — lista paginada de error_logs com filtros.
 *
 * Query params:
 *   page: default 1
 *   limit: default 25 (max 100)
 *   level: 'error' | 'warning' | 'info'
 *   company_id: filtro tenant
 *   q: full text em message
 *   since: ISO date (default: 7 dias atrás)
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireSuperAdmin()
    if (guard instanceof NextResponse) return guard

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const limit = Math.min(Number(searchParams.get('limit')) || 25, 100)
    const level = searchParams.get('level') || undefined
    const company_id = searchParams.get('company_id') || undefined
    const q = searchParams.get('q') || undefined
    const sinceParam = searchParams.get('since')
    const since = sinceParam
      ? new Date(sinceParam)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const where: any = { ts: { gte: since } }
    if (level) where.level = level
    if (company_id) where.company_id = company_id
    if (q) where.message = { contains: q, mode: 'insensitive' }

    const [rows, total] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        orderBy: { ts: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.errorLog.count({ where }),
    ])

    return paginated(rows, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}
