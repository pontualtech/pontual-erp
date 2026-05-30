import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Token curto (compatível com URL de WhatsApp) pra confirmação de visita.
 * Formato: "<stopIdShort>.<randomNonce>.<hmacSignature>" em base64url.
 *
 * Porque nao usar o payload inteiro no token (como magic-link faz):
 *  - URL vira pequena o suficiente pra caber em WhatsApp sem quebra
 *  - Token é guardado NO DB (coluna visit_confirm_token UNIQUE), então
 *    revogável quando o motorista reconcilia a parada
 *  - Sem expiração custom — fica válido até visit_confirmed_at ou
 *    manualmente invalidado
 */

function getSecret(envName: 'ENCRYPTION_KEY' | 'ENCRYPTION_KEY_OLD' = 'ENCRYPTION_KEY'): string | null {
  const s = process.env[envName] || (envName === 'ENCRYPTION_KEY' ? process.env.PORTAL_AUTH_SECRET : null)
  if (!s || s.length < 16) return envName === 'ENCRYPTION_KEY' ? (() => { throw new Error('ENCRYPTION_KEY nao configurada') })() : null
  return s + ':visit-token'
}

/** Gera novo token pra um stop. Retorna o token completo pra salvar no DB. */
export function createVisitToken(stopId: string): string {
  const nonce = randomBytes(8).toString('base64url')
  const shortId = stopId.replace(/-/g, '').slice(0, 12)
  const payload = `${shortId}.${nonce}`
  const sig = createHmac('sha256', getSecret()!).update(payload).digest('base64url').slice(0, 16)
  return `${payload}.${sig}`
}

/**
 * Verifica assinatura do token. Retorna true/false.
 * Eco audit W5 (2026-05-30): dual-key fallback durante rotação ENCRYPTION_KEY.
 */
export function verifyVisitToken(token: string): boolean {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const [shortId, nonce, sig] = parts
    const payload = `${shortId}.${nonce}`
    const sigBuf = Buffer.from(sig)

    // Tenta NEW
    const newExp = createHmac('sha256', getSecret()!).update(payload).digest('base64url').slice(0, 16)
    const newBuf = Buffer.from(newExp)
    if (sigBuf.length === newBuf.length && timingSafeEqual(sigBuf, newBuf)) return true

    // Fallback OLD
    const oldSecret = getSecret('ENCRYPTION_KEY_OLD')
    if (oldSecret) {
      const oldExp = createHmac('sha256', oldSecret).update(payload).digest('base64url').slice(0, 16)
      const oldBuf = Buffer.from(oldExp)
      if (sigBuf.length === oldBuf.length && timingSafeEqual(sigBuf, oldBuf)) return true
    }
    return false
  } catch {
    return false
  }
}
