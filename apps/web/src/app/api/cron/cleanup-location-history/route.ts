import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'

/**
 * GET /api/cron/cleanup-location-history
 *
 * Chamado pelo cron diario (1x a cada 24h). Apaga registros de
 * driver_location_history com mais de RETENTION_DAYS.
 *
 * Volume tipico: 6 GPS/min * 8h = 2880 rows/dia/motorista.
 * Com 10 motoristas: 29k rows/dia. Em 7 dias: 200k linhas.
 * Sem cleanup, cresce 10M rows/ano — pesa.
 */

const RETENTION_DAYS = 7

export async function GET(request: NextRequest) {
  // N5 fix (audit pos-fix): advisory lock pra 1 instancia rodando por vez
  try {
    const _lock: Array<{ ok: boolean }> = await (prisma as any).$queryRaw`
      SELECT pg_try_advisory_lock(hashtext('cron:cleanup-location-history')::bigint) AS ok
    `
    if (!_lock?.[0]?.ok) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'concurrent_run' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  } catch { /* non-fatal: tabela/conexao indisponivel — segue sem lock */ }

  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) return error('Cron not configured', 503)
    const authHeader = request.headers.get('authorization')
    const expected = `Bearer ${cronSecret}`
    if (!authHeader || authHeader.length !== expected.length
      || !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))) {
      return error('Unauthorized', 401)
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const result = await prisma.driverLocationHistory.deleteMany({
      where: { captured_at: { lt: cutoff } },
    })
    console.log(`[cleanup-location-history] deleted ${result.count} rows older than ${cutoff.toISOString()}`)
    return success({ deleted: result.count, cutoff: cutoff.toISOString(), retention_days: RETENTION_DAYS })
  } catch (err) {
    return handleError(err)
  }
}
