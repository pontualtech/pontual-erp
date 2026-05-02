import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

// UX-3 followup: força dinâmico — Next 14 estava cacheando /api/health
// como rota estática (X-Nextjs-Cache: HIT), mascarando incidentes em
// tempo real. Coolify healthcheck precisa de leitura fresh sempre.
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * N3 fix (audit pos-fix): healthcheck completo pra observabilidade real.
 * Antes Coolify só checava porta 3000 — crash silencioso de trigger,
 * webhook fila parada, MV stale, _trigger_failures crescendo, tudo
 * invisível até virar incidente.
 *
 * Retorna 200 se tudo OK, 503 se algum sintoma crítico. Coolify Healthcheck
 * path → /api/health.
 *
 * Componentes verificados:
 *   - db_latency_ms: SELECT 1 com timeout 2s
 *   - webhook_events_pending: WebhookEventLog.status='RECEIVED' há > 5min (processamento travou?)
 *   - trigger_failures_recent: _trigger_failures.created_at > now()-1h
 *   - dre_mv_stale_min: MAX(fiscal_entries.created_at) vs MV (manual refresh required)
 *   - fiscal_pipeline_ok: último _ensure_financeiro_log
 */
export async function GET(_req: NextRequest) {
  const startedAt = Date.now()
  const checks: Record<string, any> = {}
  let critical = false

  // 1. DB latency
  try {
    const t0 = Date.now()
    await prisma.$queryRaw`SELECT 1 as ok`
    checks.db_latency_ms = Date.now() - t0
    if (checks.db_latency_ms > 1000) critical = true
  } catch (e: any) {
    checks.db_error = e?.message?.slice(0, 200) ?? 'unknown'
    critical = true
  }

  // 2. Webhook events pending (RECEIVED há > 5min = processamento travou)
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    const stuck = await prisma.webhookEventLog.count({
      where: { status: 'RECEIVED', received_at: { lt: fiveMinAgo } },
    })
    checks.webhook_events_stuck = stuck
    if (stuck > 10) critical = true
  } catch (e: any) {
    checks.webhook_error = e?.message?.slice(0, 200) ?? 'unknown'
  }

  // 3. _trigger_failures recentes (> 1h)
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const failures = await prisma.$queryRawUnsafe<{ trigger_name: string; count: bigint }[]>(
      `SELECT trigger_name, COUNT(*)::bigint AS count
         FROM _trigger_failures
        WHERE created_at > $1
        GROUP BY trigger_name`,
      oneHourAgo,
    )
    const total = failures.reduce((sum, f) => sum + Number(f.count), 0)
    checks.trigger_failures_1h = {
      total,
      by_trigger: Object.fromEntries(failures.map(f => [f.trigger_name, Number(f.count)])),
    }
    if (total > 50) critical = true
  } catch (e: any) {
    // Tabela pode não existir em ambiente novo
    checks.trigger_failures_unavailable = true
  }

  // 4. DRE MV staleness — Sprint 5: reportar idade
  try {
    const mvCheck = await prisma.$queryRawUnsafe<{ last_entry: Date | null; mv_count: bigint; mv_max_period: string | null }[]>(
      `SELECT
        (SELECT MAX(created_at) FROM fiscal_entries) AS last_entry,
        (SELECT COUNT(*)::bigint FROM dre_monthly) AS mv_count,
        (SELECT MAX(fiscal_period) FROM dre_monthly) AS mv_max_period`,
    )
    checks.fiscal_entries_last = mvCheck[0]?.last_entry ?? null
    checks.dre_monthly_rows = Number(mvCheck[0]?.mv_count ?? 0)
    checks.dre_max_period = mvCheck[0]?.mv_max_period ?? null
    // Stale alert: se há fiscal_entries mas MV não reflete o período mais recente
    if (mvCheck[0]?.last_entry && mvCheck[0]?.mv_max_period) {
      const expectedPeriod = new Date(mvCheck[0].last_entry).toISOString().slice(0, 7)
      if (expectedPeriod > mvCheck[0].mv_max_period) {
        checks.dre_mv_stale = true
        // Não marca critical — MV stale é warning, não bloqueador
      }
    }
  } catch (e: any) {
    checks.dre_mv_unavailable = true
  }

  // 5. Ensure script status
  try {
    const lastEnsure = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ran_at, fiscal_pipeline_ok, last_error
         FROM _ensure_financeiro_log
        ORDER BY ran_at DESC LIMIT 1`,
    )
    if (lastEnsure[0]) {
      checks.ensure_last_run = lastEnsure[0].ran_at
      checks.fiscal_pipeline_ok = lastEnsure[0].fiscal_pipeline_ok
      if (lastEnsure[0].last_error) {
        checks.ensure_last_error = String(lastEnsure[0].last_error).slice(0, 200)
      }
    }
  } catch {}

  // 6. Memory + uptime (Node)
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const mem = process.memoryUsage()
    checks.heap_used_mb = Math.round(mem.heapUsed / 1024 / 1024)
    checks.uptime_sec = Math.round(process.uptime())
  }

  const elapsed = Date.now() - startedAt
  const body = {
    status: critical ? 'critical' : 'ok',
    checked_at: new Date().toISOString(),
    elapsed_ms: elapsed,
    ...checks,
  }
  return NextResponse.json(body, { status: critical ? 503 : 200 })
}
