import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

/**
 * GET /api/audit-logs
 * Returns paginated audit logs with filters
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, parseInt(searchParams.get('limit') || '50'))
    const module = searchParams.get('module') || undefined
    const action = searchParams.get('action') || undefined
    const userId = searchParams.get('user_id') || undefined
    const search = searchParams.get('search') || undefined
    const dateFrom = searchParams.get('from') || undefined
    const dateTo = searchParams.get('to') || undefined

    const where: any = { company_id: user.companyId }
    if (module) where.module = module
    if (action) where.action = { contains: action, mode: 'insensitive' }
    if (userId) where.user_id = userId
    if (dateFrom || dateTo) {
      where.created_at = {}
      if (dateFrom) where.created_at.gte = new Date(dateFrom)
      if (dateTo) where.created_at.lte = new Date(dateTo + 'T23:59:59')
    }
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { entity_id: { contains: search, mode: 'insensitive' } },
        { user_id: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ])

    // Resolve user names
    const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean))]
    const users = userIds.length > 0
      ? await prisma.userProfile.findMany({
          where: { id: { in: userIds }, company_id: user.companyId },
          select: { id: true, name: true },
        })
      : []
    const userMap = new Map(users.map(u => [u.id, u.name]))

    // Get distinct modules for filter dropdown
    const modules: { module: string }[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT module FROM audit_logs WHERE company_id = $1 ORDER BY module`,
      user.companyId
    )

    return success({
      logs: logs.map(l => ({
        ...l,
        user_name: userMap.get(l.user_id) || (l.user_id === 'portal' ? 'Portal (Cliente)' : l.user_id === 'system' ? 'Sistema' : l.user_id),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      modules: modules.map(m => m.module),
    })
  } catch (err) {
    return handleError(err)
  }
}
