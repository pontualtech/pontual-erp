/**
 * Observability — error logging, health snapshots, anti-flood alerts.
 *
 * Princípios:
 *  - Fail-soft: nenhuma falha aqui pode quebrar o caller. Se gravar em DB
 *    falhar, console.error e segue (anti-recursão — logError não chama logError).
 *  - Anti-flood: 1 alerta por tipo+tenant a cada 1h (cooldown via alert_state).
 *  - Tenant aware: company_id quando disponível; sentinel '__global__' pra
 *    alertas de infra que afetam todo mundo (DB down, memory leak, etc).
 */

import { prisma } from '@pontual/db'
import { sendCompanyEmail, sendEmail } from './send-email'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ErrorContext {
  request_id?: string
  url?: string
  method?: string
  user_id?: string
  company_id?: string
  ip?: string
  params?: Record<string, unknown>
  /** Qualquer outra coisa útil pra debug — vai pra context_json */
  [key: string]: unknown
}

export type AlertSeverity = 'info' | 'warning' | 'critical'

export type AlertChannel = 'email' | 'chatwoot'

const GLOBAL_TENANT = '__global__'
const ALERT_COOLDOWN_MS = 60 * 60 * 1000 // 1h entre alertas do mesmo tipo

// ─────────────────────────────────────────────
// 1. logError — grava exception em error_logs
// ─────────────────────────────────────────────

/**
 * Grava um erro em error_logs. Fire-and-forget: nunca lança, nunca quebra o caller.
 *
 * Uso típico (em handleError ou catch handler):
 *   logError(err, { request_id, url, method, user_id, company_id })
 *
 * NOTA: trunca message em 500 chars e stack em 10000 chars pra evitar
 * DB blow-up se algum erro tiver stack gigante de framework.
 */
export async function logError(
  err: unknown,
  context: ErrorContext = {},
  level: 'error' | 'warning' | 'info' = 'error',
): Promise<void> {
  try {
    const message = (() => {
      if (err instanceof Error) return err.message.slice(0, 500)
      if (typeof err === 'string') return err.slice(0, 500)
      try { return JSON.stringify(err).slice(0, 500) } catch { return 'Unknown error' }
    })()

    const stack = err instanceof Error && err.stack
      ? err.stack.slice(0, 10000)
      : null

    const { request_id, user_id, company_id, ...rest } = context

    await prisma.errorLog.create({
      data: {
        level,
        message,
        stack,
        context_json: rest as any,
        user_id: user_id || null,
        company_id: company_id || null,
        request_id: request_id || null,
      },
    })
  } catch (logErr) {
    // Anti-recursão: NÃO chamar logError aqui. Stderr cai no Coolify logs.
    console.error('[Observability:logError] Failed to persist error:', logErr)
  }
}

// ─────────────────────────────────────────────
// 2. captureHealthSnapshot — chama /api/health e persiste
// ─────────────────────────────────────────────

/**
 * Chama /api/health internamente e persiste o response em health_snapshots.
 * Retorna o snapshot gravado (ou null se falhou).
 *
 * Chamado pelo cron /api/internal/cron/health-monitor a cada 5min.
 */
export async function captureHealthSnapshot(): Promise<{
  status: string
  elapsed_ms: number
} | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || process.env.APP_URL
    || 'http://localhost:3000'

  const start = Date.now()
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      // Sem cache: snapshot é sempre fresco
      cache: 'no-store',
      // Timeout 10s (health endpoint completo leva ~1-2s tipicamente)
      signal: AbortSignal.timeout(10000),
    })

    const elapsed_ms = Date.now() - start
    const data = await res.json().catch(() => ({ status: 'critical', error: 'parse_failed' }))
    const status = data?.status || (res.ok ? 'ok' : 'critical')

    await prisma.healthSnapshot.create({
      data: {
        status,
        elapsed_ms,
        data_json: data,
      },
    })

    return { status, elapsed_ms }
  } catch (err) {
    const elapsed_ms = Date.now() - start
    console.error('[Observability:captureHealthSnapshot] Failed:', err)

    // Persiste o próprio fail — saber que /api/health caiu É uma info de health
    try {
      await prisma.healthSnapshot.create({
        data: {
          status: 'critical',
          elapsed_ms,
          data_json: {
            error: err instanceof Error ? err.message : String(err),
            captured_by: 'observability.captureHealthSnapshot',
          },
        },
      })
    } catch {
      // DB também tá fora — só log
    }

    return null
  }
}

// ─────────────────────────────────────────────
// 3. sendAlert — alerta com anti-flood (1h cooldown)
// ─────────────────────────────────────────────

/**
 * Envia alerta operacional via canal configurado. Anti-flood: 1 envio por
 * tipo+tenant a cada 1h. Detecções subsequentes em cooldown incrementam
 * occurrence_count (pra debug) mas NÃO disparam novo envio.
 *
 * Canal padrão: email (via Setting alerts.email_to ou fallback ALERT_EMAIL env).
 * Canal opcional: Chatwoot (se Setting alerts.chatwoot_url presente).
 *
 * @param type Tipo do alerta (ex: 'db_down', 'webhook_stuck', 'memory_high')
 * @param message Mensagem human-readable
 * @param severity 'info' | 'warning' | 'critical'
 * @param companyId UUID do tenant (omit pra alertas globais de infra)
 * @returns true se enviou agora, false se em cooldown ou falhou
 */
export async function sendAlert(
  type: string,
  message: string,
  severity: AlertSeverity = 'warning',
  companyId?: string,
): Promise<boolean> {
  const tenant = companyId || GLOBAL_TENANT
  const now = new Date()

  try {
    // Upsert anti-flood: se existe, checar cooldown; senão, criar.
    // Nota: o nome da chave composta no where do Prisma é
    // <fieldA>_<fieldB> (auto-gerado a partir de @@unique sem `name:`).
    const existing = await prisma.alertState.findUnique({
      where: { alert_type_company_id: { alert_type: type, company_id: tenant } },
    })

    if (existing) {
      const elapsed = now.getTime() - new Date(existing.last_sent_at).getTime()
      if (elapsed < ALERT_COOLDOWN_MS) {
        // Em cooldown — só incrementa contador e atualiza detecção
        await prisma.alertState.update({
          where: { id: existing.id },
          data: {
            last_detected_at: now,
            occurrence_count: { increment: 1 },
          },
        })
        return false
      }

      // Cooldown expirou — atualiza last_sent_at e dispara
      await prisma.alertState.update({
        where: { id: existing.id },
        data: {
          last_sent_at: now,
          last_detected_at: now,
          occurrence_count: { increment: 1 },
        },
      })
    } else {
      // Primeira ocorrência — cria registro
      await prisma.alertState.create({
        data: {
          alert_type: type,
          company_id: tenant,
          last_sent_at: now,
          last_detected_at: now,
          occurrence_count: 1,
        },
      })
    }

    // Dispara o envio
    const sent = await deliverAlert(type, message, severity, companyId)
    if (!sent) {
      console.error(`[Observability:sendAlert] Delivery failed for ${type}`)
    }
    return sent
  } catch (err) {
    console.error('[Observability:sendAlert] Failed:', err)
    return false
  }
}

// ─────────────────────────────────────────────
// Internal: deliverAlert (email channel — Chatwoot opcional futuro)
// ─────────────────────────────────────────────

async function deliverAlert(
  type: string,
  message: string,
  severity: AlertSeverity,
  companyId?: string,
): Promise<boolean> {
  const recipient = await getAlertRecipient(companyId)
  if (!recipient) {
    console.error(`[Observability:deliverAlert] No recipient configured for tenant ${companyId || 'global'}`)
    return false
  }

  const emoji = severity === 'critical' ? '[CRITICAL]' : severity === 'warning' ? '[WARN]' : '[INFO]'
  const subject = `${emoji} Alerta ERP: ${type}`
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px;">
      <h2 style="color: ${severity === 'critical' ? '#c00' : severity === 'warning' ? '#c80' : '#06c'};">
        ${emoji} ${type}
      </h2>
      <p style="font-size: 14px; line-height: 1.5;">${escapeHtml(message)}</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #888;">
        Tenant: ${companyId || 'global (infra)'}<br>
        Disparado em: ${new Date().toISOString()}<br>
        Próximo envio possível: ${new Date(Date.now() + ALERT_COOLDOWN_MS).toISOString()}
      </p>
    </div>
  `.trim()

  // Se temos companyId, usa config do tenant; senão, fallback global
  if (companyId) {
    return sendCompanyEmail(companyId, recipient, subject, html)
  }
  return sendEmail(recipient, subject, html)
}

/**
 * Resolve email de destino do alerta. Preferência:
 *  1. Setting alerts.email_to (do tenant)
 *  2. process.env.ALERT_EMAIL (global)
 *  3. process.env.SUPERADMIN_EMAIL (fallback)
 */
async function getAlertRecipient(companyId?: string): Promise<string | null> {
  if (companyId) {
    const setting = await prisma.setting.findFirst({
      where: { company_id: companyId, key: 'alerts.email_to' },
    }).catch(() => null)
    if (setting?.value) return setting.value
  }
  return process.env.ALERT_EMAIL
    || process.env.SUPERADMIN_EMAIL
    || null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
