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
    await startEmailBlastWorker()
  }
}

/**
 * Inicia BullMQ Worker pro email-blast (2026-05-29).
 * Sem REDIS_URL = no-op silencioso (dev local). Em prod e configurado.
 */
async function startEmailBlastWorker() {
  try {
    const { startEmailWorker } = await import('@/lib/email-queue')
    startEmailWorker()
  } catch (err) {
    console.error('[Instrumentation/EmailBlast] failed to start worker:', err instanceof Error ? err.message : err)
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

  // Eco audit A2 (2026-05-29): wrapper que registra última execução de cada
  // cron interno em settings (via lib/cron-health.markCronRun). Antes deste
  // wrapper, cron-health-monitor era CEGO aos 9 crons internos — falhas
  // silenciosas em produção (descobertas em audit ecosystem 29/05).
  // Dynamic import evita circular dep + lazy carrega Prisma no boot.
  const trackHealth = async (cronName: string, ok: boolean, durationMs: number, error?: string) => {
    try {
      const { markCronRun } = await import('@/lib/cron-health')
      await markCronRun(cronName, { ok, duration_ms: durationMs, error })
    } catch (err) {
      // Best-effort — não deixa telemetry derrubar cron
      console.error(`[CronHealth/${cronName}] track failed (non-fatal):`, err instanceof Error ? err.message : err)
    }
  }

  // Cold-start warming (2026-05-30): setInterval(fn, intervalMs) só dispara
  // após intervalMs ms. Em crons com interval ≥ threshold-buffer (cobranca-
  // reenvio-vencidas: 1h interval, 90min threshold = 30min buffer), 1 restart
  // > 30min causa alerta "stale" cry-wolf em cron-health-monitor. scheduleCron
  // adiciona first-run 5s após boot (não-bloqueante) — zera o gap pós-restart.
  // 5s é folga pro lib/cron-health (Prisma) carregar antes do primeiro tick.
  // Caso real Karlão 30/05 11:05Z: cobranca-reenvio-vencidas alertou após
  // restart madrugada; aplicado em todos os 8 crons rastreados em INTERNAL_CRON_THRESHOLDS.
  const scheduleCron = (fn: () => Promise<void>, intervalMs: number) => {
    setTimeout(() => { fn().catch(() => {}) }, 5000)
    setInterval(fn, intervalMs)
  }

  // Bot Follow-up — every 5 minutes
  scheduleCron(async () => {
    const t0 = Date.now()
    try {
      const res = await fetch(`${BASE_URL}/api/cron/bot-followup`, { headers })
      if (res.ok) {
        const data = await res.json()
        if (data.data?.sent > 0) {
          console.log(`[Cron/BotFollowUp] Sent ${data.data.sent} follow-ups`)
        }
        await trackHealth('bot-followup', true, Date.now() - t0)
      } else {
        console.error(`[Cron/BotFollowUp] HTTP ${res.status}`)
        await trackHealth('bot-followup', false, Date.now() - t0, `HTTP ${res.status}`)
      }
    } catch (err) {
      console.error('[Cron/BotFollowUp] Error:', err instanceof Error ? err.message : err)
      await trackHealth('bot-followup', false, Date.now() - t0, err instanceof Error ? err.message : String(err))
    }
  }, 5 * 60 * 1000) // 5 minutes

  // Quote Reminder — every 30 minutes
  scheduleCron(async () => {
    const t0 = Date.now()
    try {
      const res = await fetch(`${BASE_URL}/api/cron/lembrete-orcamento`, { headers })
      if (res.ok) {
        const data = await res.json()
        const emails = data.data?.emails_sent || 0
        const whatsapp = data.data?.whatsapp_sent || 0
        if (emails > 0 || whatsapp > 0) {
          console.log(`[Cron/LembreteOrcamento] emails_sent=${emails} whatsapp_sent=${whatsapp}`)
        }
        await trackHealth('lembrete-orcamento', true, Date.now() - t0)
      } else {
        await trackHealth('lembrete-orcamento', false, Date.now() - t0, `HTTP ${res.status}`)
      }
    } catch (err) {
      console.error('[Cron/LembreteOrcamento] Error:', err instanceof Error ? err.message : err)
      await trackHealth('lembrete-orcamento', false, Date.now() - t0, err instanceof Error ? err.message : String(err))
    }
  }, 30 * 60 * 1000) // 30 minutes

  // Billing Reminder — every hour
  scheduleCron(async () => {
    const t0 = Date.now()
    try {
      const res = await fetch(`${BASE_URL}/api/cron/cobranca`, { headers })
      if (res.ok) {
        const data = await res.json()
        if (data.data?.sent > 0) {
          console.log(`[Cron/Cobranca] Sent ${data.data.sent} billing reminders`)
        }
        await trackHealth('cobranca', true, Date.now() - t0)
      } else {
        await trackHealth('cobranca', false, Date.now() - t0, `HTTP ${res.status}`)
      }
    } catch (err) {
      console.error('[Cron/Cobranca] Error:', err instanceof Error ? err.message : err)
      await trackHealth('cobranca', false, Date.now() - t0, err instanceof Error ? err.message : String(err))
    }
  }, 60 * 60 * 1000) // 1 hour

  // Payment Reminders V2 (Wave AE-2) — every 10 minutes
  // Régua de cobrança nova: scheduler (cria PaymentReminders) + dispatcher
  // (envia via Meta/email quando PAYMENT_REMINDERS_V2_REAL_DISPATCH=1).
  // Endpoint deployado desde 25/05 mas ficou órfão de cron até este fix
  // (audit operador humano 2026-05-26).
  scheduleCron(async () => {
    const t0 = Date.now()
    try {
      const res = await fetch(`${BASE_URL}/api/cron/payment-reminders-v2`, { headers })
      if (res.ok) {
        const data = await res.json()
        const sched = data.data?.scheduled || 0
        const disp = data.data?.dispatched || 0
        const fail = data.data?.dispatch_failures || 0
        if (sched > 0 || disp > 0 || fail > 0) {
          console.log(`[Cron/PaymentRemindersV2] scheduled=${sched} dispatched=${disp} failures=${fail}`)
        }
        await trackHealth('payment-reminders-v2', true, Date.now() - t0)
      } else {
        console.error(`[Cron/PaymentRemindersV2] HTTP ${res.status}`)
        await trackHealth('payment-reminders-v2', false, Date.now() - t0, `HTTP ${res.status}`)
      }
    } catch (err) {
      console.error('[Cron/PaymentRemindersV2] Error:', err instanceof Error ? err.message : err)
      await trackHealth('payment-reminders-v2', false, Date.now() - t0, err instanceof Error ? err.message : String(err))
    }
  }, 10 * 60 * 1000) // 10 minutes

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
    scheduleCron(async () => {
      const t0 = Date.now()
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
          await trackHealth('google-reviews', true, Date.now() - t0)
        } else {
          // Logging defensivo: ate antes desse fix, 401 ficava silencioso
          // pq nao tinha else aqui. Cron rodou 5 dias mudo em prod.
          console.error(`[Cron/GoogleReviews] HTTP ${res.status}`)
          await trackHealth('google-reviews', false, Date.now() - t0, `HTTP ${res.status}`)
        }
      } catch (err) {
        console.error('[Cron/GoogleReviews] Error:', err instanceof Error ? err.message : err)
        await trackHealth('google-reviews', false, Date.now() - t0, err instanceof Error ? err.message : String(err))
      }
    }, 5 * 60 * 1000) // 5 minutes
  }

  // M4-pt2 (audit 2026-05-23) — one-shot ensure _trigger_failures table.
  // SQL direto via Prisma (sem fetch/auth) pra eliminar timing+auth issues.
  // Resolve healthcheck `trigger_failures_unavailable=true`.
  // Idempotente: CREATE TABLE IF NOT EXISTS.
  ;(async () => {
    try {
      const { prisma } = await import('@pontual/db')
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS _trigger_failures (
          id serial primary key,
          trigger_name text NOT NULL,
          payload jsonb,
          error_msg text,
          error_state text,
          created_at timestamptz DEFAULT NOW()
        )
      `)
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_trigger_failures_recent
          ON _trigger_failures (created_at DESC)
      `)
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION fn_record_trigger_failure(
          p_trigger text, p_payload jsonb, p_msg text, p_state text
        ) RETURNS void AS $rec$
        BEGIN
          INSERT INTO _trigger_failures (trigger_name, payload, error_msg, error_state)
          VALUES (p_trigger, p_payload, p_msg, p_state);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_record_trigger_failure ITSELF failed for %: % (%)', p_trigger, SQLERRM, SQLSTATE;
        END;
        $rec$ LANGUAGE plpgsql
      `)
      console.log('[Boot/EnsureTriggerFailures] OK — table+index+function criados (idempotente)')
    } catch (err) {
      console.error('[Boot/EnsureTriggerFailures] FAIL:', err instanceof Error ? err.message : err)
    }
  })()

  // Wave AS-1 (2026-05-27) — ensure column expected_credit_date em accounts_receivable.
  // Fluxo de caixa lê pra mostrar receitas "RECEBIDO mas aguardando crédito" (Asaas
  // crédito = D+32). Migration idempotente; reload schema cache do PostgREST após.
  ;(async () => {
    try {
      const { prisma } = await import('@pontual/db')
      await prisma.$executeRawUnsafe(`
        ALTER TABLE accounts_receivable
        ADD COLUMN IF NOT EXISTS expected_credit_date DATE
      `)
      // PostgREST cacheia schema — reload pra ver coluna nova imediatamente
      await prisma.$executeRawUnsafe(`NOTIFY pgrst, 'reload schema'`).catch(() => {})
      console.log('[Boot/EnsureExpectedCreditDate] OK — column adicionada (idempotente)')
    } catch (err) {
      console.error('[Boot/EnsureExpectedCreditDate] FAIL:', err instanceof Error ? err.message : err)
    }
  })()

  // Wave SU-1 (2026-05-27) fix I2 — ensure index idx_ap_supplier.
  // Schema.prisma declara @@index([supplier_id]) mas ERP não roda
  // prisma migrate deploy no build (vide outras waves). Sem este boot
  // ALTER, queries WHERE supplier_id = X em accounts_payable fazem full
  // scan. Idempotente: CREATE INDEX IF NOT EXISTS.
  ;(async () => {
    try {
      const { prisma } = await import('@pontual/db')
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_ap_supplier
          ON accounts_payable (supplier_id)
      `)
      console.log('[Boot/EnsureApSupplierIndex] OK — index criado (idempotente)')
    } catch (err) {
      console.error('[Boot/EnsureApSupplierIndex] FAIL:', err instanceof Error ? err.message : err)
    }
  })()

  // 2026-05-29 (CRIT-DATA-STRING fix) — recupera bot_conversations.data
  // corrompido como JSONB string (do bug em route.ts:1159 `data: '{}'`).
  // 94% das 666 convs desde 22/05 tinham data='"{}"' (string), tornando
  // jsonb_typeof(data)='string' e quebrando data->>'attribution' queries.
  // Idempotente: roda 1x no boot, depois 0 rows (fix code já evita novos).
  ;(async () => {
    try {
      const { prisma } = await import('@pontual/db')
      const result: any = await prisma.$executeRawUnsafe(`
        UPDATE bot_conversations
        SET data = '{}'::jsonb
        WHERE jsonb_typeof(data) = 'string'
      `)
      console.log(`[Boot/FixDataStringCorruption] OK — ${result} rows recuperadas (jsonb_typeof=string → {})`)
    } catch (err) {
      console.error('[Boot/FixDataStringCorruption] FAIL:', err instanceof Error ? err.message : err)
    }
  })()

  // M4 (audit 2026-05-23) — DRE materialized view refresh a cada 30min
  // dre_monthly era refrescada só por UI admin → healthcheck dre_mv_stale=true
  // permanente. Endpoint /api/internal/cron/dre-mv-refresh já existia mas
  // ninguém chamava. Agora cron interno fecha o loop.
  if (!INTERNAL_API_KEY) {
    console.warn('[Cron/DreMvRefresh] INTERNAL_API_KEY ausente — cron desabilitado')
  } else {
    scheduleCron(async () => {
      const t0 = Date.now()
      try {
        const res = await fetch(`${BASE_URL}/api/internal/cron/dre-mv-refresh`, {
          headers: { 'x-internal-key': INTERNAL_API_KEY },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.data?.ok && !data.data?.skipped) {
            console.log(`[Cron/DreMvRefresh] refreshed (${data.data.mode}) in ${data.data.elapsed_ms}ms — ${data.data.mv_rows} rows`)
          }
          await trackHealth('dre-mv-refresh', true, Date.now() - t0)
        } else {
          console.error(`[Cron/DreMvRefresh] HTTP ${res.status}`)
          await trackHealth('dre-mv-refresh', false, Date.now() - t0, `HTTP ${res.status}`)
        }
      } catch (err) {
        console.error('[Cron/DreMvRefresh] Error:', err instanceof Error ? err.message : err)
        await trackHealth('dre-mv-refresh', false, Date.now() - t0, err instanceof Error ? err.message : String(err))
      }
    }, 30 * 60 * 1000) // 30 minutes
  }

  // Cobrança reenvio diario — feature 2026-05-14 feat 7/7
  // Roda a cada 1h. Cooldown 20h por cobranca (em /api/internal/cron/...)
  // garante max 1 envio/dia/AR mesmo com 24 execucoes/dia.
  if (!INTERNAL_API_KEY) {
    console.warn('[Cron/CobrancaReenvio] INTERNAL_API_KEY ausente — cron desabilitado')
  } else {
    scheduleCron(async () => {
      const t0 = Date.now()
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
          await trackHealth('cobranca-reenvio-vencidas', true, Date.now() - t0)
        } else {
          console.error(`[Cron/CobrancaReenvio] HTTP ${res.status}`)
          await trackHealth('cobranca-reenvio-vencidas', false, Date.now() - t0, `HTTP ${res.status}`)
        }
      } catch (err) {
        console.error('[Cron/CobrancaReenvio] Error:', err instanceof Error ? err.message : err)
        await trackHealth('cobranca-reenvio-vencidas', false, Date.now() - t0, err instanceof Error ? err.message : String(err))
      }
    }, 60 * 60 * 1000) // 1 hour
  }

  // 2026-05-29 — Nurture tick (audit pos-deploy 29/05 detectou journey
  // bot_abandono orfã: Irene capturada 14:41 sem cron processando steps).
  // Endpoint /api/internal/cron/nurture-tick faz 2 etapas:
  //   1. detectReactivations — fecha journeys cujo cliente abriu OS
  //   2. processSteps — envia próximo email/wa do playbook
  // Advisory lock interno previne concorrência. Roda a cada 15min — playbook
  // tem steps em D0/D7/D15/D30/D60+, latência sub-hora é suficiente.
  if (!INTERNAL_API_KEY) {
    console.warn('[Cron/NurtureTick] INTERNAL_API_KEY ausente — cron desabilitado')
  } else {
    scheduleCron(async () => {
      const t0 = Date.now()
      try {
        const res = await fetch(`${BASE_URL}/api/internal/cron/nurture-tick`, {
          method: 'POST',
          headers: { 'x-internal-key': INTERNAL_API_KEY },
        })
        if (res.ok) {
          const data = await res.json()
          const d = data.data || {}
          if (d.reactivations > 0 || d.steps_sent_email > 0 || d.steps_sent_wa > 0) {
            console.log(`[Cron/NurtureTick] reactivations=${d.reactivations} email=${d.steps_sent_email} wa=${d.steps_sent_wa} failed=${d.failed}`)
          }
          await trackHealth('nurture-tick', true, Date.now() - t0)
        } else {
          console.error(`[Cron/NurtureTick] HTTP ${res.status}`)
          await trackHealth('nurture-tick', false, Date.now() - t0, `HTTP ${res.status}`)
        }
      } catch (err) {
        console.error('[Cron/NurtureTick] Error:', err instanceof Error ? err.message : err)
        await trackHealth('nurture-tick', false, Date.now() - t0, err instanceof Error ? err.message : String(err))
      }
    }, 15 * 60 * 1000) // 15 minutes
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
