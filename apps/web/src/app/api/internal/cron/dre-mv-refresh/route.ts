import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { success, handleError } from '@/lib/api-response'
import { requireInternalKey } from '@/lib/internal-auth'

/**
 * Sprint 5 fix (audit pos-fix): cron de REFRESH MATERIALIZED VIEW
 * dre_monthly. Antes só refresh manual via UI admin — DRE podia mostrar
 * dados defasados de semanas sem alertar.
 *
 * Política: refresh CONCURRENTLY (não bloqueia leituras), gated por
 * advisory lock (1 instância por vez), com fallback pra REFRESH normal
 * se CONCURRENTLY falhar (primeira refresh, MV recém-criada).
 *
 * Cron sugerido: a cada 30min via instrumentation.ts ou Coolify task.
 */
export async function GET(req: NextRequest) {
  const guard = requireInternalKey(req); if (guard) return guard

  // Advisory lock pra evitar 2 réplicas refrescando paralelo
  const lock = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext('cron:dre-mv-refresh')::bigint) AS ok
  `
  if (!lock[0]?.ok) {
    return success({ skipped: true, reason: 'concurrent_run' })
  }

  const startedAt = Date.now()
  try {
    // Tenta CONCURRENTLY primeiro (não-bloqueante)
    let mode = 'concurrently'
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY dre_monthly`)
    } catch (e: any) {
      // CONCURRENTLY exige unique index + populated; fallback normal
      mode = 'normal'
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW dre_monthly`)
    }
    const elapsed = Date.now() - startedAt

    // Conta linhas pra healthcheck reporting
    const stats = await prisma.$queryRaw<Array<{ rows: bigint; max_period: string | null }>>`
      SELECT COUNT(*)::bigint AS rows, MAX(fiscal_period) AS max_period FROM dre_monthly
    `

    return success({
      ok: true,
      mode,
      elapsed_ms: elapsed,
      mv_rows: Number(stats[0]?.rows ?? 0),
      max_period: stats[0]?.max_period,
      refreshed_at: new Date().toISOString(),
    })
  } catch (err) {
    return handleError(err)
  } finally {
    await prisma.$executeRaw`SELECT pg_advisory_unlock(hashtext('cron:dre-mv-refresh')::bigint)`.catch(() => {})
  }
}
