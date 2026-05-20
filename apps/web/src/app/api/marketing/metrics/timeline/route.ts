/**
 * Timeline diária de automation runs (success/failed/skipped) no range.
 *
 * GET /api/marketing/metrics/timeline?range=7d|30d|90d
 *
 * Retorna array de {date, success, failed, skipped} cobrindo todos os dias
 * do range (mesmo os zero — pra chart contínuo sem gaps).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const range = req.nextUrl.searchParams.get('range') || '30d'
    const days = RANGE_DAYS[range] ?? 30
    const since = new Date(Date.now() - days * 86400 * 1000)
    since.setHours(0, 0, 0, 0)

    type Row = { day: Date; status: string; cnt: bigint }
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT date_trunc('day', created_at AT TIME ZONE 'America/Sao_Paulo') AS day,
             status,
             COUNT(*)::bigint AS cnt
      FROM marketing_automation_runs
      WHERE company_id = ${user.companyId}
        AND created_at >= ${since}
      GROUP BY day, status
      ORDER BY day ASC
    `

    // Bucketize por dia
    const buckets = new Map<string, { success: number; failed: number; skipped: number; running: number; pending: number }>()
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 86400 * 1000)
      const key = d.toISOString().slice(0, 10)
      buckets.set(key, { success: 0, failed: 0, skipped: 0, running: 0, pending: 0 })
    }
    for (const r of rows) {
      const key = new Date(r.day).toISOString().slice(0, 10)
      const b = buckets.get(key)
      if (!b) continue
      const s = r.status as keyof typeof b
      if (s in b) b[s] = Number(r.cnt)
    }

    const timeline = Array.from(buckets.entries()).map(([date, v]) => ({
      date,
      ...v,
      total: v.success + v.failed + v.skipped + v.running + v.pending,
    }))

    return success({ range, days, timeline })
  } catch (e) {
    return handleError(e)
  }
}
