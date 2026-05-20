/**
 * Top tags (excluindo prefixos técnicos stage:/segment:/year:) pra chart de
 * tags mais usadas pela equipe (interesse_*, source_*, custom).
 *
 * GET /api/marketing/metrics/tags?limit=10
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const limit = Math.min(50, Math.max(1, Number(url.get('limit') || '10')))

    type Row = { tag: string; count: bigint }
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT tag, COUNT(*)::bigint AS count
      FROM marketing_contacts c, unnest(c.tags) AS tag
      WHERE c.company_id = ${user.companyId}
        AND tag NOT LIKE 'stage:%'
        AND tag NOT LIKE 'segment:%'
        AND tag NOT LIKE 'year:%'
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT ${limit}
    `

    const tags = rows.map(r => ({ tag: r.tag, count: Number(r.count) }))
    return success({ tags })
  } catch (e) {
    return handleError(e)
  }
}
