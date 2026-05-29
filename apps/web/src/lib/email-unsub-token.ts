import crypto from 'node:crypto'

/**
 * HMAC token pra one-click unsubscribe RFC 8058.
 *
 * Sender (lib/send-email.ts ou lib/email-queue/sender.ts) chama buildUnsubscribeUrl
 * quando envia email pra produzir URL personalizada per-recipient. O endpoint
 * /api/public/unsubscribe valida o token e bypass rate limit quando valido
 * (URL veio do sender = confiavel, nao requer throttle anti-abuso).
 *
 * Token = `${timestamp}.${HMAC-SHA256(secret, email + timestamp)}` (base64url sig).
 * TTL 90 dias — janela razoavel pra cliente abrir email antigo.
 *
 * Verificacao usa timingSafeEqual pra nao vazar tempo. Se ERP_TOKEN_SECRET
 * trocar, tokens antigos invalidam — modo agressivo de revogar todos os links
 * antigos se preciso.
 */

const HMAC_TTL_MS = 90 * 24 * 60 * 60 * 1000

function getSecret(): string {
  return process.env.ERP_TOKEN_SECRET
    || process.env.CRON_SECRET
    || (process.env.NODE_ENV === 'production'
        ? (() => { throw new Error('ERP_TOKEN_SECRET ausente em producao') })()
        : 'dev-fallback-unsub-secret-local-only')
}

function buildHmac(email: string, ts: number): string {
  return crypto.createHmac('sha256', getSecret()).update(`${email}|${ts}`).digest('base64url')
}

export function buildUnsubscribeToken(email: string): string {
  const ts = Date.now()
  return `${ts}.${buildHmac(email, ts)}`
}

export function buildUnsubscribeUrl(email: string, baseUrl = 'https://erp.pontualtech.work'): string {
  const t = buildUnsubscribeToken(email)
  return `${baseUrl}/api/public/unsubscribe?email=${encodeURIComponent(email)}&t=${t}`
}

export function verifyUnsubscribeToken(token: string, email: string): boolean {
  try {
    const [tsStr, sig] = token.split('.')
    if (!tsStr || !sig) return false
    const ts = parseInt(tsStr, 10)
    if (!ts || Date.now() - ts > HMAC_TTL_MS) return false
    const expected = buildHmac(email, ts)
    const a = Buffer.from(expected)
    const b = Buffer.from(sig)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}
