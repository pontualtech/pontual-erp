/**
 * Next.js Instrumentation — runs once on server startup.
 * Used to register internal cron jobs (setInterval).
 *
 * This replaces the need for external cron (n8n, crontab, etc.)
 * for tasks like bot follow-up, quote reminders, and billing reminders.
 */

let cronStarted = false

export async function register() {
  // Only run crons on the server (not during build or edge)
  // Guard prevents duplicate intervals on hot reload (dev mode)
  if (process.env.NEXT_RUNTIME === 'nodejs' && !cronStarted) {
    cronStarted = true
    startCronJobs()
  }
}

function startCronJobs() {
  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const CRON_SECRET = process.env.CRON_SECRET

  if (!CRON_SECRET) {
    console.warn('[Cron] CRON_SECRET not set — internal crons disabled')
    return
  }

  const headers = { Authorization: `Bearer ${CRON_SECRET}` }

  // Bot Follow-up — every 5 minutes
  setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/cron/bot-followup`, { headers })
      if (res.ok) {
        const data = await res.json()
        if (data.data?.sent > 0) {
          console.log(`[Cron/BotFollowUp] Sent ${data.data.sent} follow-ups`)
        }
      } else {
        console.error(`[Cron/BotFollowUp] HTTP ${res.status}`)
      }
    } catch (err) {
      console.error('[Cron/BotFollowUp] Error:', err instanceof Error ? err.message : err)
    }
  }, 5 * 60 * 1000) // 5 minutes

  // Quote Reminder — every 30 minutes
  setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/cron/lembrete-orcamento`, { headers })
      if (res.ok) {
        const data = await res.json()
        if (data.data?.emails_sent > 0) {
          console.log(`[Cron/LembreteOrcamento] Sent ${data.data.emails_sent} reminders`)
        }
      }
    } catch (err) {
      console.error('[Cron/LembreteOrcamento] Error:', err instanceof Error ? err.message : err)
    }
  }, 30 * 60 * 1000) // 30 minutes

  // Billing Reminder — every hour
  setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/cron/cobranca`, { headers })
      if (res.ok) {
        const data = await res.json()
        if (data.data?.sent > 0) {
          console.log(`[Cron/Cobranca] Sent ${data.data.sent} billing reminders`)
        }
      }
    } catch (err) {
      console.error('[Cron/Cobranca] Error:', err instanceof Error ? err.message : err)
    }
  }, 60 * 60 * 1000) // 1 hour

  // Driver Inactivity — every 10 minutes (so-opera em horario comercial)
  setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/cron/driver-inactivity`, { headers })
      if (res.ok) {
        const data = await res.json()
        if (data.data?.alerted > 0) {
          console.log(`[Cron/DriverInactivity] Alerted ${data.data.alerted} drivers`)
        }
      }
    } catch (err) {
      console.error('[Cron/DriverInactivity] Error:', err instanceof Error ? err.message : err)
    }
  }, 10 * 60 * 1000) // 10 minutes

  // Location history cleanup — once every 24h (ultima madrugada)
  setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/cron/cleanup-location-history`, { headers })
      if (res.ok) {
        const data = await res.json()
        if (data.data?.deleted > 0) {
          console.log(`[Cron/CleanupLocation] Deleted ${data.data.deleted} old GPS rows`)
        }
      }
    } catch (err) {
      console.error('[Cron/CleanupLocation] Error:', err instanceof Error ? err.message : err)
    }
  }, 24 * 60 * 60 * 1000) // 24 hours

  // Google Reviews — every 5 min (envia link avaliacao 10min apos entrega aprovada)
  // Diferente dos outros crons: este endpoint exige `x-internal-key` com
  // INTERNAL_API_KEY (audit C9 endureceu auth em 2026-05-01). Se mudarmos
  // pra Authorization: Bearer CRON_SECRET o endpoint retorna 401 silencioso.
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY
  if (!INTERNAL_API_KEY) {
    console.warn('[Cron/GoogleReviews] INTERNAL_API_KEY ausente — cron desabilitado')
  } else {
    setInterval(async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/internal/cron/google-reviews`, {
          method: 'POST',
          headers: { 'x-internal-key': INTERNAL_API_KEY },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.data?.sent > 0) {
            console.log(`[Cron/GoogleReviews] Sent ${data.data.sent} review links`)
          }
        } else {
          // Logging defensivo: ate antes desse fix, 401 ficava silencioso
          // pq nao tinha else aqui. Cron rodou 5 dias mudo em prod.
          console.error(`[Cron/GoogleReviews] HTTP ${res.status}`)
        }
      } catch (err) {
        console.error('[Cron/GoogleReviews] Error:', err instanceof Error ? err.message : err)
      }
    }, 5 * 60 * 1000) // 5 minutes
  }

  // M4-pt2 (audit 2026-05-23) — one-shot ensure _trigger_failures table.
  // Roda 30s após boot pra dar tempo do Next servir requests. Resolve o
  // healthcheck flag `trigger_failures_unavailable=true` que ocorria porque
  // o ensure-financeiro-extras.sh falhava antes de criar essa tabela.
  // Endpoint é idempotente (CREATE IF NOT EXISTS) — pode rodar todo boot.
  if (INTERNAL_API_KEY) {
    setTimeout(async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/admin/diag/trigger-failures`, {
          method: 'POST',
          headers: { 'x-internal-key': INTERNAL_API_KEY },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.data?.created) {
            console.log(`[Boot/EnsureTriggerFailures] OK — table_exists=${data.data.table_exists}`)
          }
        } else {
          console.warn(`[Boot/EnsureTriggerFailures] HTTP ${res.status}`)
        }
      } catch (err) {
        console.warn('[Boot/EnsureTriggerFailures] Error:', err instanceof Error ? err.message : err)
      }
    }, 30 * 1000)
  }

  // M4 (audit 2026-05-23) — DRE materialized view refresh a cada 30min
  // dre_monthly era refrescada só por UI admin → healthcheck dre_mv_stale=true
  // permanente. Endpoint /api/internal/cron/dre-mv-refresh já existia mas
  // ninguém chamava. Agora cron interno fecha o loop.
  if (!INTERNAL_API_KEY) {
    console.warn('[Cron/DreMvRefresh] INTERNAL_API_KEY ausente — cron desabilitado')
  } else {
    setInterval(async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/internal/cron/dre-mv-refresh`, {
          headers: { 'x-internal-key': INTERNAL_API_KEY },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.data?.ok && !data.data?.skipped) {
            console.log(`[Cron/DreMvRefresh] refreshed (${data.data.mode}) in ${data.data.elapsed_ms}ms — ${data.data.mv_rows} rows`)
          }
        } else {
          console.error(`[Cron/DreMvRefresh] HTTP ${res.status}`)
        }
      } catch (err) {
        console.error('[Cron/DreMvRefresh] Error:', err instanceof Error ? err.message : err)
      }
    }, 30 * 60 * 1000) // 30 minutes
  }

  // Cobrança reenvio diario — feature 2026-05-14 feat 7/7
  // Roda a cada 1h. Cooldown 20h por cobranca (em /api/internal/cron/...)
  // garante max 1 envio/dia/AR mesmo com 24 execucoes/dia.
  if (!INTERNAL_API_KEY) {
    console.warn('[Cron/CobrancaReenvio] INTERNAL_API_KEY ausente — cron desabilitado')
  } else {
    setInterval(async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/internal/cron/cobranca-reenvio-vencidas`, {
          method: 'POST',
          headers: { 'x-internal-key': INTERNAL_API_KEY },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.data?.ok_count > 0) {
            console.log(`[Cron/CobrancaReenvio] Reenviadas ${data.data.ok_count}/${data.data.processed} cobrancas`)
          }
        } else {
          console.error(`[Cron/CobrancaReenvio] HTTP ${res.status}`)
        }
      } catch (err) {
        console.error('[Cron/CobrancaReenvio] Error:', err instanceof Error ? err.message : err)
      }
    }, 60 * 60 * 1000) // 1 hour
  }

  console.log('[Cron] Internal cron jobs started:')
  console.log('  - Bot Follow-up: every 5 min')
  console.log('  - Quote Reminder: every 30 min')
  console.log('  - Billing Reminder: every 1 hour')
  console.log('  - Driver Inactivity: every 10 min')
  console.log('  - Google Reviews: every 5 min')
  // Audit fix 2026-05-14 #7: log condicional pro cron novo. Antes
  // imprimia ativo mesmo quando INTERNAL_API_KEY ausente (cron desabilitado).
  if (INTERNAL_API_KEY) {
    console.log('  - Cobranca Reenvio Vencidas: every 1h (cooldown 20h/AR)')
    console.log('  - DRE MV Refresh: every 30min')
  } else {
    console.log('  - Cobranca Reenvio Vencidas: DESABILITADO (INTERNAL_API_KEY ausente)')
    console.log('  - DRE MV Refresh: DESABILITADO (INTERNAL_API_KEY ausente)')
  }
  console.log('  - Cleanup Location History: every 24h')
}
