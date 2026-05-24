import { NextRequest } from 'next/server'
import { success, handleError } from '@/lib/api-response'
import { requireInternalKey } from '@/lib/internal-auth'
import { captureHealthSnapshot, sendAlert } from '@/lib/observability'

/**
 * Health monitor cron — snapshot periodico de /api/health pra serie temporal
 * + auto-alert quando status === 'critical'.
 *
 * Setup:
 *   Coolify scheduler ou cron Linux a cada 5min:
 *   curl -X POST https://erp.pontualtech.work/api/internal/cron/health-monitor \
 *     -H "x-internal-key: $INTERNAL_API_KEY"
 *
 * Anti-flood: o helper sendAlert() respeita cooldown 1h por tipo. Detecções
 * subsequentes ficam em occurrence_count mas não disparam email.
 */
// GET delegates to POST — cobre Coolify scheduled task que usa wget GET por padrão
export async function GET(req: NextRequest) {
  return POST(req)
}

export async function POST(req: NextRequest) {
  const guard = requireInternalKey(req)
  if (guard) return guard

  try {
    const snapshot = await captureHealthSnapshot()

    if (!snapshot) {
      // captureHealthSnapshot já loga em stderr e persiste o fail como critical
      return success({
        ok: false,
        captured: false,
        reason: 'snapshot_failed',
      })
    }

    let alert_dispatched = false
    if (snapshot.status !== 'ok') {
      alert_dispatched = await sendAlert(
        `health_${snapshot.status}`,
        `Health check retornou status="${snapshot.status}" (elapsed_ms=${snapshot.elapsed_ms}). ` +
          `Veja /admin/health pra detalhes.`,
        snapshot.status === 'critical' ? 'critical' : 'warning',
      )
    }

    return success({
      ok: snapshot.status === 'ok',
      captured: true,
      status: snapshot.status,
      elapsed_ms: snapshot.elapsed_ms,
      alert_dispatched,
    })
  } catch (err) {
    return handleError(err)
  }
}
