/**
 * Next.js Instrumentation — runs once on server startup.
 * Used to register internal cron jobs (setInterval).
 *
 * This replaces the need for external cron (n8n, crontab, etc.)
 * for tasks like bot follow-up, quote reminders, and billing reminders.
 */

export async function register() {
  // Only run crons on the server (not during build or edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
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

  console.log('[Cron] Internal cron jobs started:')
  console.log('  - Bot Follow-up: every 5 min')
  console.log('  - Quote Reminder: every 30 min')
  console.log('  - Billing Reminder: every 1 hour')
}
