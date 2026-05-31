import { prisma } from '@pontual/db'

/**
 * Eco audit A2 (2026-05-29): observability pros crons INTERNOS do
 * instrumentation.ts (bot-followup, payment-reminders-v2, cobranca,
 * cobranca-reenvio-vencidas, atraso-reparo, lembrete-orcamento,
 * google-reviews, evolution-zombie-check, voip-cleanup-stale-ringing).
 *
 * Antes desta lib o cron-health-monitor só observava scheduled-tasks
 * Coolify — os 9 crons internos podiam falhar silenciosamente.
 *
 * Padrão de uso (em cada cron):
 *   import { markCronRun } from '@/lib/cron-health'
 *   // ... lógica do cron ...
 *   await markCronRun('payment-reminders-v2', { ok: true, summary: {...} })
 *
 * Armazenamento: tabela `settings` (multi-tenant ready, sem migration).
 * Key: `cron.health.{name}.last_run_at` (ISO) e `.last_status` (ok|fail).
 * company_id usado = 'GLOBAL' (placeholder pra dados de plataforma).
 */

// BUG FIX 2026-05-30: 'GLOBAL' não existe em companies (FK violation).
// Usar PT-001 como tenant default pro health data — funciona bem porque
// queries do monitor filtram por key prefix `cron.health.*`, não por tenant.
// company_id pode ser overridden via env CRON_HEALTH_COMPANY_ID em SaaS.
const HEALTH_COMPANY_ID = process.env.CRON_HEALTH_COMPANY_ID || 'pontualtech-001'

export interface CronRunMeta {
  ok: boolean
  summary?: Record<string, unknown>
  error?: string
  duration_ms?: number
}

/**
 * Registra última execução de um cron interno.
 * Best-effort: nunca propaga erro (cron não deve falhar por causa de telemetry).
 */
export async function markCronRun(cronName: string, meta: CronRunMeta): Promise<void> {
  try {
    const now = new Date().toISOString()
    const status = meta.ok ? 'ok' : 'fail'

    await prisma.setting.upsert({
      where: {
        company_id_key: {
          company_id: HEALTH_COMPANY_ID,
          key: `cron.health.${cronName}.last_run_at`,
        },
      },
      create: {
        company_id: HEALTH_COMPANY_ID,
        key: `cron.health.${cronName}.last_run_at`,
        value: now,
      },
      update: { value: now },
    })

    await prisma.setting.upsert({
      where: {
        company_id_key: {
          company_id: HEALTH_COMPANY_ID,
          key: `cron.health.${cronName}.last_status`,
        },
      },
      create: {
        company_id: HEALTH_COMPANY_ID,
        key: `cron.health.${cronName}.last_status`,
        value: status,
      },
      update: { value: status },
    })

    // Tracking de consecutive_fails: incrementa em fail, zera em ok.
    if (!meta.ok) {
      const fails = await prisma.setting.findUnique({
        where: {
          company_id_key: {
            company_id: HEALTH_COMPANY_ID,
            key: `cron.health.${cronName}.consecutive_fails`,
          },
        },
      })
      const next = String(parseInt(fails?.value || '0', 10) + 1)
      await prisma.setting.upsert({
        where: {
          company_id_key: {
            company_id: HEALTH_COMPANY_ID,
            key: `cron.health.${cronName}.consecutive_fails`,
          },
        },
        create: {
          company_id: HEALTH_COMPANY_ID,
          key: `cron.health.${cronName}.consecutive_fails`,
          value: next,
        },
        update: { value: next },
      })
    } else {
      await prisma.setting.upsert({
        where: {
          company_id_key: {
            company_id: HEALTH_COMPANY_ID,
            key: `cron.health.${cronName}.consecutive_fails`,
          },
        },
        create: {
          company_id: HEALTH_COMPANY_ID,
          key: `cron.health.${cronName}.consecutive_fails`,
          value: '0',
        },
        update: { value: '0' },
      })
    }
  } catch (err) {
    console.error(`[cron-health/${cronName}] markCronRun failed (non-fatal):`, err instanceof Error ? err.message : err)
  }
}

export interface InternalCronHealth {
  name: string
  last_run_at: string | null
  last_status: 'ok' | 'fail' | null
  consecutive_fails: number
  age_min: number | null
  expected_max_min: number
  verdict: 'healthy' | 'failing' | 'stale' | 'never_ran' | 'unknown'
}

/**
 * Crons internos rastreados + threshold de staleness (em minutos).
 * Se age_min > expected_max_min, cron é considerado stale (alerta).
 */
/**
 * Audit 30/05: removidos 3 fantasmas que disparavam alerta CRITICAL "instrumentation.ts
 * quebrado?" hourly. Esses 3 são scheduled tasks Coolify, NÃO setInterval do
 * instrumentation.ts — já cobertos pelo bloco SCHEDULED do cron-health-monitor.
 * Listá-los aqui causava cry-wolf (esperam markCronRun() de um path que nunca chama).
 *
 * Bonus: adicionado nurture-tick (estava órfão — instrumentado mas sem threshold).
 */
export const INTERNAL_CRON_THRESHOLDS: Record<string, number> = {
  // setInterval internos do instrumentation.ts (Eco audit A2 fix):
  // APENAS crons que TÊM chamada markCronRun() — adicionar entry aqui
  // sem instrumentar o cron gera falso-positivo "never_ran" no monitor.
  'bot-followup': 15,                       // 5min → alerta >15min
  'payment-reminders-v2': 30,               // 10min → alerta >30min
  'cobranca': 75,                           // 1h → alerta >75min
  'lembrete-orcamento': 90,                 // 30min → alerta >90min
  'google-reviews': 15,                     // 5min → alerta >15min
  'dre-mv-refresh': 90,                     // 30min → alerta >90min
  'cobranca-reenvio-vencidas': 90,          // 1h → alerta >90min
  'nurture-tick': 30,                       // 15min → alerta >30min (audit 30/05 — antes órfão)
  'fixed-expenses': 480,                    // 6h → alerta >8h (feature 31/05 Karlão)
  // BUG FIX 2026-05-30: atraso-reparo, evolution-zombie-check e
  // voip-cleanup-stale-ringing REMOVIDOS daqui. Esses são SCHEDULED TASKS
  // do Coolify (não internos do instrumentation.ts), portanto JÁ MONITORADOS
  // pelo bloco original do cron-health-monitor que lê scheduled-tasks API.
  // Tinha redundância achando que era "extra safety", mas como eles nunca
  // chamam markCronRun (não estão em setInterval interno), o monitor
  // reportava "never_ran" e disparava alerta crítico falso a cada hora.
  // Caso real Karlão 30/05: email "internal_cron_stale_voip-cleanup-stale-ringing".
}

/**
 * Lê health de todos os crons internos rastreados.
 * Usado por /api/internal/cron/cron-health-monitor.
 */
export async function getAllInternalCronHealth(): Promise<InternalCronHealth[]> {
  const cronNames = Object.keys(INTERNAL_CRON_THRESHOLDS)
  const result: InternalCronHealth[] = []
  const now = Date.now()

  for (const name of cronNames) {
    const lastRunSetting = await prisma.setting.findUnique({
      where: {
        company_id_key: {
          company_id: HEALTH_COMPANY_ID,
          key: `cron.health.${name}.last_run_at`,
        },
      },
    })
    const lastStatusSetting = await prisma.setting.findUnique({
      where: {
        company_id_key: {
          company_id: HEALTH_COMPANY_ID,
          key: `cron.health.${name}.last_status`,
        },
      },
    })
    const failsSetting = await prisma.setting.findUnique({
      where: {
        company_id_key: {
          company_id: HEALTH_COMPANY_ID,
          key: `cron.health.${name}.consecutive_fails`,
        },
      },
    })

    const lastRunAt = lastRunSetting?.value || null
    const lastStatus = (lastStatusSetting?.value as 'ok' | 'fail') || null
    const consecutiveFails = parseInt(failsSetting?.value || '0', 10)
    const expectedMaxMin = INTERNAL_CRON_THRESHOLDS[name]

    let ageMin: number | null = null
    let verdict: InternalCronHealth['verdict'] = 'unknown'

    if (!lastRunAt) {
      verdict = 'never_ran'
    } else {
      ageMin = Math.floor((now - new Date(lastRunAt).getTime()) / 60000)
      if (consecutiveFails >= 3) verdict = 'failing'
      else if (ageMin > expectedMaxMin) verdict = 'stale'
      else verdict = 'healthy'
    }

    result.push({
      name,
      last_run_at: lastRunAt,
      last_status: lastStatus,
      consecutive_fails: consecutiveFails,
      age_min: ageMin,
      expected_max_min: expectedMaxMin,
      verdict,
    })
  }

  return result
}
