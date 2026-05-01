import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError, error } from '@/lib/api-response'

// POST /api/financeiro/v2/dre/refresh
// Force REFRESH MATERIALIZED VIEW dre_monthly. Requires financeiro:edit (admin/manager).
export async function POST(_request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result

    const startedAt = Date.now()

    // CONCURRENTLY exige índice unique. Em primeira refresh sem dados pode falhar — fallback normal.
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY dre_monthly;`)
    } catch (e) {
      try {
        await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW dre_monthly;`)
      } catch (inner) {
        return error(`REFRESH MV falhou: ${(inner as Error).message}`, 500)
      }
    }

    const elapsed = Date.now() - startedAt

    const stats = await prisma.$queryRawUnsafe<Array<{ rows: bigint }>>(
      `SELECT COUNT(*)::bigint AS rows FROM dre_monthly`
    )

    return success({
      ok: true,
      elapsed_ms: elapsed,
      mv_rows: Number(stats[0]?.rows ?? 0),
      refreshed_at: new Date().toISOString(),
    })
  } catch (err) {
    return handleError(err)
  }
}
