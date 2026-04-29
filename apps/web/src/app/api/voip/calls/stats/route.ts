/**
 * GET /api/voip/calls/stats — agregados rápidos de chamadas pra dashboard + bell:
 *   today: total/answered/missed/outbound/avgDurationSec
 *   missedCount: perdidas últimas 24h (badge do bell)
 *   recentMissed: até 5 últimas perdidas (dropdown do bell)
 */

import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requireAuth } from '@/lib/auth'
import { handleError, success } from '@/lib/api-response'

const MISSED_STATUSES = ['missed', 'no_answer', 'busy', 'failed']

export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth()
    const companyId = user.companyId

    const startToday = new Date()
    startToday.setHours(0, 0, 0, 0)
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const [todayTotal, todayAnswered, todayMissed, todayOutbound, todayAvgDur, missed24hCount, recentMissed] = await Promise.all([
      prisma.voipCall.count({
        where: { company_id: companyId, started_at: { gte: startToday } },
      }),
      prisma.voipCall.count({
        where: {
          company_id: companyId,
          started_at: { gte: startToday },
          status: { in: ['answered', 'completed'] },
        },
      }),
      prisma.voipCall.count({
        where: {
          company_id: companyId,
          started_at: { gte: startToday },
          status: { in: MISSED_STATUSES },
        },
      }),
      prisma.voipCall.count({
        where: { company_id: companyId, started_at: { gte: startToday }, direction: 'outbound' },
      }),
      prisma.voipCall.aggregate({
        where: {
          company_id: companyId,
          started_at: { gte: startToday },
          status: { in: ['answered', 'completed'] },
          duration_sec: { not: null },
        },
        _avg: { duration_sec: true },
      }),
      prisma.voipCall.count({
        where: {
          company_id: companyId,
          started_at: { gte: since24h },
          status: { in: MISSED_STATUSES },
        },
      }),
      prisma.voipCall.findMany({
        where: {
          company_id: companyId,
          started_at: { gte: since24h },
          status: { in: MISSED_STATUSES },
        },
        orderBy: { started_at: 'desc' },
        take: 5,
        select: {
          id: true,
          from_number: true,
          to_number: true,
          direction: true,
          status: true,
          started_at: true,
          customers: { select: { id: true, legal_name: true, trade_name: true } },
        },
      }),
    ])

    return success({
      today: {
        total: todayTotal,
        answered: todayAnswered,
        missed: todayMissed,
        outbound: todayOutbound,
        avgDurationSec: Math.round(todayAvgDur._avg.duration_sec ?? 0),
      },
      missedCount: missed24hCount,
      recentMissed,
    })
  } catch (e) {
    return handleError(e)
  }
}
