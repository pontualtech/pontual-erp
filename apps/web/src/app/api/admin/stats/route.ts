import { NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

// GET /api/admin/stats — Métricas globais do SaaS
export async function GET() {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const [
      totalCompanies,
      activeCompanies,
      totalUsers,
      totalOs,
      totalCustomers,
      companiesWithCounts,
      recentOs,
    ] = await Promise.all([
      prisma.company.count(),
      prisma.company.count({ where: { is_active: true } }),
      prisma.userProfile.count({ where: { is_active: true } }),
      prisma.serviceOrder.count(),
      prisma.customer.count(),
      prisma.company.findMany({
        where: { is_active: true },
        select: {
          id: true,
          name: true,
          slug: true,
          created_at: true,
          _count: { select: { service_orders: true, customers: true, user_profiles: true } },
        },
        orderBy: { created_at: 'desc' },
      }),
      prisma.serviceOrder.count({
        where: { created_at: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      }),
    ])

    return success({
      totals: {
        companies: totalCompanies,
        activeCompanies,
        users: totalUsers,
        serviceOrders: totalOs,
        customers: totalCustomers,
        osLast30Days: recentOs,
      },
      companies: companiesWithCounts,
    })
  } catch (err) {
    return handleError(err)
  }
}
