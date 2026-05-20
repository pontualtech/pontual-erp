import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const cId = user.companyId
    const range = req.nextUrl.searchParams.get('range') || '30d'
    const days = RANGE_DAYS[range] ?? 30
    const since = new Date(Date.now() - days * 86400 * 1000)

    const [
      totalContacts,
      unsubCount,
      bouncedCount,
      automationsActive,
      campaignsLastRange,
      automationRunsLastRange,
    ] = await Promise.all([
      prisma.marketingContact.count({ where: { company_id: cId } }),
      prisma.marketingContact.count({ where: { company_id: cId, unsubscribed: true } }),
      prisma.marketingContact.count({ where: { company_id: cId, bounce_count: { gt: 0 } } }),
      prisma.marketingStageAutomation.count({ where: { company_id: cId, active: true } }),
      prisma.marketingWebhookEvent.count({
        where: {
          company_id: cId,
          event_type: 'email.sent',
          received_at: { gte: since },
        },
      }),
      prisma.marketingAutomationRun.count({
        where: { company_id: cId, created_at: { gte: since } },
      }),
    ])

    const unsubRate = totalContacts > 0 ? unsubCount / totalContacts : 0
    const bounceRate = totalContacts > 0 ? bouncedCount / totalContacts : 0

    return success({
      range,
      kpis: {
        totalContacts,
        unsubCount,
        unsubRate,
        bouncedCount,
        bounceRate,
        automationsActive,
        campaignsLastRange,
        automationRunsLastRange,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
