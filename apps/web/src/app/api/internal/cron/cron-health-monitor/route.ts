import { NextRequest } from 'next/server'
import { success, handleError } from '@/lib/api-response'
import { requireInternalKey } from '@/lib/internal-auth'
import { sendAlert } from '@/lib/observability'
import { getAllInternalCronHealth, type InternalCronHealth } from '@/lib/cron-health'

/**
 * Meta-monitoring: pollla Coolify API e detecta scheduled tasks quebradas.
 *
 * Dispara alerta quando:
 *   (a) as 3 ultimas execucoes consecutivas falharam, OU
 *   (b) nao ha nova execucao dentro de 3x o intervalo esperado da frequencia
 *
 * Anti-flood: sendAlert() tem cooldown 1h built-in por type+tenant.
 *
 * Setup:
 *   Env: COOLIFY_API_URL, COOLIFY_API_TOKEN, COOLIFY_APP_UUID
 *   Coolify scheduler 0 * * * * (hourly):
 *     wget -qO- --post-data="{}" --header="X-Internal-Key: $INTERNAL_API_KEY" \
 *       https://erp.pontualtech.work/api/internal/cron/cron-health-monitor
 */

const STALE_MULTIPLIER = 3

interface TaskMeta {
  uuid: string
  name: string
  command: string
  frequency: string
  enabled: boolean
}

interface Execution {
  uuid: string
  status: string
  duration: string
  message: string | null
  created_at: string
}

interface TaskCheck {
  name: string
  uuid: string
  frequency: string
  consecutive_fails: number
  last_status: string | null
  last_exec_age_min: number | null
  stale_threshold_min: number
  verdict: 'healthy' | 'failing' | 'stale' | 'unknown'
}

function parseFrequencyToMinutes(freq: string): number {
  const f = freq.trim()
  // */N * * * * (every N min)
  let m = f.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*/)
  if (m) return parseInt(m[1], 10)
  // 0 */N * * * (every N hours at minute 0)
  m = f.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*/)
  if (m) return parseInt(m[1], 10) * 60
  // 0 H,H,H * * * (N specific hours/day)
  m = f.match(/^0\s+([\d,]+)\s+\*\s+\*\s+\*/)
  if (m) {
    const count = m[1].split(',').length
    if (count > 1) return Math.floor(1440 / count)
    return 1440
  }
  // 0 H * * * (daily)
  if (/^0\s+\d+\s+\*\s+\*\s+\*$/.test(f)) return 1440
  // Default conservative: 1 day
  return 1440
}

async function coolifyFetch<T>(path: string, token: string, baseUrl: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Coolify ${path} -> ${res.status}`)
  return res.json()
}

export async function GET(req: NextRequest) {
  return POST(req)
}

export async function POST(req: NextRequest) {
  const guard = requireInternalKey(req)
  if (guard) return guard

  const baseUrl = process.env.COOLIFY_API_URL
  const token = process.env.COOLIFY_API_TOKEN
  const appUuid = process.env.COOLIFY_APP_UUID

  if (!baseUrl || !token || !appUuid) {
    return success({
      ok: false,
      reason: 'missing_env',
      missing: {
        COOLIFY_API_URL: !baseUrl,
        COOLIFY_API_TOKEN: !token,
        COOLIFY_APP_UUID: !appUuid,
      },
    })
  }

  try {
    const tasks = await coolifyFetch<TaskMeta[]>(
      `/api/v1/applications/${appUuid}/scheduled-tasks`,
      token,
      baseUrl,
    )

    const checks: TaskCheck[] = []
    const now = Date.now()
    let alerts_dispatched = 0

    for (const t of tasks) {
      if (!t.enabled) {
        checks.push({
          name: t.name,
          uuid: t.uuid,
          frequency: t.frequency,
          consecutive_fails: 0,
          last_status: null,
          last_exec_age_min: null,
          stale_threshold_min: 0,
          verdict: 'unknown',
        })
        continue
      }

      const execs = await coolifyFetch<Execution[]>(
        `/api/v1/applications/${appUuid}/scheduled-tasks/${t.uuid}/executions`,
        token,
        baseUrl,
      )
      execs.sort((a, b) => b.created_at.localeCompare(a.created_at))
      const recent = execs.slice(0, 10)

      let consecutive = 0
      for (const e of recent) {
        if (e.status === 'failed') consecutive++
        else break
      }

      const last = recent[0]
      const lastAgeMin = last
        ? Math.floor((now - new Date(last.created_at).getTime()) / 60000)
        : null
      const expectedMin = parseFrequencyToMinutes(t.frequency)
      const staleThreshold = expectedMin * STALE_MULTIPLIER

      let verdict: TaskCheck['verdict'] = 'healthy'
      if (consecutive >= 3) verdict = 'failing'
      else if (lastAgeMin === null || lastAgeMin > staleThreshold) verdict = 'stale'

      checks.push({
        name: t.name,
        uuid: t.uuid,
        frequency: t.frequency,
        consecutive_fails: consecutive,
        last_status: last?.status ?? null,
        last_exec_age_min: lastAgeMin,
        stale_threshold_min: staleThreshold,
        verdict,
      })

      if (verdict === 'failing') {
        const lastMsg = (last?.message ?? '').slice(0, 200).replace(/\n/g, ' ')
        const dispatched = await sendAlert(
          `cron_failing_${t.name}`,
          `Cron "${t.name}" falhou ${consecutive} vezes consecutivas. Ultima msg: ${lastMsg}`,
          'critical',
        )
        if (dispatched) alerts_dispatched++
      } else if (verdict === 'stale') {
        const dispatched = await sendAlert(
          `cron_stale_${t.name}`,
          `Cron "${t.name}" sem execucao ha ${lastAgeMin ?? '???'}min (esperado <=${staleThreshold}min). Scheduler parado?`,
          'critical',
        )
        if (dispatched) alerts_dispatched++
      }
    }

    // Eco audit A2 (2026-05-29): também monitora crons INTERNOS do
    // instrumentation.ts (9 crons que rodam via setInterval no boot do
    // Next.js, fora do scheduler Coolify). Antes deste fix eram cegos.
    const internalHealth = await getAllInternalCronHealth()
    let internal_alerts = 0
    for (const ic of internalHealth) {
      if (ic.verdict === 'failing') {
        const dispatched = await sendAlert(
          `internal_cron_failing_${ic.name}`,
          `Cron interno "${ic.name}" falhou ${ic.consecutive_fails}x consecutivas. Último run há ${ic.age_min}min.`,
          'critical',
        )
        if (dispatched) internal_alerts++
      } else if (ic.verdict === 'stale' || ic.verdict === 'never_ran') {
        const dispatched = await sendAlert(
          `internal_cron_stale_${ic.name}`,
          ic.verdict === 'never_ran'
            ? `Cron interno "${ic.name}" NUNCA rodou desde último boot. instrumentation.ts quebrado?`
            : `Cron interno "${ic.name}" sem execução há ${ic.age_min}min (esperado <=${ic.expected_max_min}min). Scheduler interno parado?`,
          'critical',
        )
        if (dispatched) internal_alerts++
      }
    }

    return success({
      ok: true,
      // Crons SCHEDULED do Coolify
      total_tasks: tasks.length,
      checked: checks.filter(c => c.verdict !== 'unknown').length,
      healthy: checks.filter(c => c.verdict === 'healthy').length,
      failing: checks.filter(c => c.verdict === 'failing').length,
      stale: checks.filter(c => c.verdict === 'stale').length,
      alerts_dispatched,
      details: checks,
      // Crons INTERNOS do instrumentation.ts (Eco audit A2)
      internal_total: internalHealth.length,
      internal_healthy: internalHealth.filter(c => c.verdict === 'healthy').length,
      internal_failing: internalHealth.filter(c => c.verdict === 'failing').length,
      internal_stale: internalHealth.filter(c => c.verdict === 'stale').length,
      internal_never_ran: internalHealth.filter(c => c.verdict === 'never_ran').length,
      internal_alerts_dispatched: internal_alerts,
      internal_details: internalHealth,
    })
  } catch (err) {
    return handleError(err)
  }
}
