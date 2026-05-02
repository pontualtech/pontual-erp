import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { success, handleError } from '@/lib/api-response'
import { requireInternalKey } from '@/lib/internal-auth'

/**
 * N33 fix (audit pos-fix): cron retention cleanup pra tabelas que crescem
 * indefinidamente (audit_logs, payment_history, _trigger_failures,
 * voip_audit_log, chatbot_logs).
 *
 * Sem cleanup, em 6 meses audit_logs vira o maior storage do DB.
 *
 * GET /api/internal/cron/retention-cleanup (CRON_SECRET → INTERNAL_API_KEY)
 *   ?dry_run=1 só conta sem deletar
 *
 * Política default (configurável via env):
 *   - audit_logs: 90d
 *   - payment_history: 365d (compliance fiscal — manter mais)
 *   - _trigger_failures: 30d
 *   - voip_audit_log: 90d
 *   - chatbot_logs: 60d
 *
 * N5: advisory lock pra evitar 2 réplicas rodando simultâneo.
 * Retorna counts deletados por tabela.
 */
export async function GET(req: NextRequest) {
  const guard = requireInternalKey(req); if (guard) return guard

  const { searchParams } = new URL(req.url)
  const dryRun = searchParams.get('dry_run') === '1'

  // Lock advisory
  const lock = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext('cron:retention-cleanup')::bigint) AS ok
  `
  if (!lock[0]?.ok) {
    return success({ skipped: true, reason: 'concurrent_run' })
  }

  try {
    const policies: Array<{ table: string; days: number; column?: string }> = [
      { table: 'audit_logs', days: Number(process.env.RETENTION_AUDIT_DAYS) || 90 },
      { table: 'payment_history', days: Number(process.env.RETENTION_PAYMENT_HISTORY_DAYS) || 365 },
      { table: '_trigger_failures', days: 30 },
      { table: 'voip_audit_log', days: 90 },
      { table: 'chatbot_logs', days: 60 },
    ]

    const results: Record<string, { deleted: number; cutoff: string }> = {}
    for (const p of policies) {
      const cutoff = new Date(Date.now() - p.days * 24 * 60 * 60 * 1000)
      try {
        // Verifica se tabela existe antes
        const tblExists = await prisma.$queryRawUnsafe<any[]>(
          `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
          p.table,
        )
        if (!tblExists || tblExists.length === 0) {
          results[p.table] = { deleted: -1, cutoff: cutoff.toISOString() }
          continue
        }
        if (dryRun) {
          const cnt = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*)::bigint AS count FROM ${p.table} WHERE created_at < $1`,
            cutoff,
          )
          results[p.table] = { deleted: Number(cnt[0]?.count ?? 0), cutoff: cutoff.toISOString() }
        } else {
          const deleted = await prisma.$executeRawUnsafe(
            `DELETE FROM ${p.table} WHERE created_at < $1`,
            cutoff,
          )
          results[p.table] = { deleted: Number(deleted) || 0, cutoff: cutoff.toISOString() }
        }
      } catch (e: any) {
        results[p.table] = { deleted: -2, cutoff: 'error: ' + (e?.message?.slice(0, 100) ?? 'unknown') }
      }
    }

    return success({ ok: true, dry_run: dryRun, results })
  } catch (err) {
    return handleError(err)
  } finally {
    await prisma.$executeRaw`SELECT pg_advisory_unlock(hashtext('cron:retention-cleanup')::bigint)`.catch(() => {})
  }
}
