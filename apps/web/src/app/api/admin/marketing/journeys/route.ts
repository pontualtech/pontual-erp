import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/admin/marketing/journeys (2026-05-29)
 *
 * Lista journeys de nurture pra inspeção/debug. Útil pra:
 *  - Ver quem está em jornada agora (active)
 *  - Ver quem reativou (abriu OS depois — outcome=reactivated)
 *  - Ver quem foi marcado unsubscribed / bounce
 *
 * Query params (todos opcionais):
 *  - type=bot_abandono|recused_os   filtro por journey_type
 *  - status=active|reactivated|ended filtro por estado
 *  - limit=N (default 50, max 200)
 *
 * Response: { journeys: [...], counts: {...} }
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('marketing', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const journeyType = url.get('type') || null
    const status = url.get('status') || 'active'
    const limit = Math.min(200, Math.max(1, parseInt(url.get('limit') || '50', 10)))

    const where: any = { company_id: user.companyId }
    if (journeyType) where.journey_type = journeyType
    if (status === 'active') where.ended_at = null
    else if (status === 'reactivated') where.outcome = 'reactivated'
    else if (status === 'ended') where.ended_at = { not: null as any }

    const journeys = await prisma.marketingJourney.findMany({
      where,
      take: limit,
      orderBy: { started_at: 'desc' },
      include: {
        contact: {
          select: {
            email: true,
            phone: true,
            name: true,
            tags: true,
            unsubscribed: true,
            bounce_count: true,
          },
        },
      },
    })

    return success({
      filter: { journey_type: journeyType, status, limit },
      count: journeys.length,
      journeys: journeys.map(j => ({
        id: j.id,
        journey_type: j.journey_type,
        current_step: j.current_step,
        started_at: j.started_at,
        last_step_at: j.last_step_at,
        ended_at: j.ended_at,
        outcome: j.outcome,
        contact: j.contact,
        source_data: j.source_data,
      })),
    })
  } catch (e) {
    return handleError(e)
  }
}
