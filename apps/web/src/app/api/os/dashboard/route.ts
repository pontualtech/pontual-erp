import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const days = Number(url.get('days') || '30')
    const since = new Date()
    since.setDate(since.getDate() - days)

    const where: any = { company_id: user.companyId, deleted_at: null }
    const wherePeriod: any = { ...where, created_at: { gte: since } }

    // Get final statuses first
    const finalStatuses = await prisma.moduleStatus.findMany({
      where: { company_id: user.companyId, module: 'os', is_final: true },
      select: { id: true },
    })
    const finalIds = finalStatuses.map(s => s.id)

    // Parallel queries for dashboard stats
    const [
      totalOpen,
      totalPeriod,
      byStatus,
      byPriority,
      byType,
      revenueAgg,
      overdueCount,
    ] = await Promise.all([
      // Total open (non-final statuses)
      prisma.serviceOrder.count({
        where: { ...where, status_id: { notIn: finalIds } },
      }),

      // Created in period
      prisma.serviceOrder.count({ where: wherePeriod }),

      // Group by status
      prisma.serviceOrder.groupBy({
        by: ['status_id'],
        where,
        _count: { id: true },
      }),

      // Group by priority
      prisma.serviceOrder.groupBy({
        by: ['priority'],
        where: wherePeriod,
        _count: { id: true },
      }),

      // Group by type
      prisma.serviceOrder.groupBy({
        by: ['os_type'],
        where: wherePeriod,
        _count: { id: true },
      }),

      // Revenue in period (total_cost of OS)
      prisma.serviceOrder.aggregate({
        where: wherePeriod,
        _sum: { total_cost: true },
      }),

      // Overdue OS (estimated_delivery passed, not final)
      prisma.serviceOrder.count({
        where: {
          ...where,
          status_id: { notIn: finalIds },
          estimated_delivery: { lt: new Date() },
        },
      }),
    ])

    return success({
      totalOpen,
      totalPeriod,
      overdueCount,
      revenue: revenueAgg._sum.total_cost || 0,
      byStatus,
      byPriority,
      byType,
    })
  } catch (err) {
    return handleError(err)
  }
}
