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

function getSecret(): string {
  const s = process.env.ENCRYPTION_KEY || process.env.PORTAL_AUTH_SECRET
  if (!s || s.length < 16) throw new Error('ENCRYPTION_KEY nao configurada')
  return s + ':visit-token'
}

/** Gera novo token pra um stop. Retorna o token completo pra salvar no DB. */
export function createVisitToken(stopId: string): string {
  const nonce = randomBytes(8).toString('base64url')
  const shortId = stopId.replace(/-/g, '').slice(0, 12)
  const payload = `${shortId}.${nonce}`
  const sig = createHmac('sha256', getSecret()).update(payload).digest('base64url').slice(0, 16)
  return `${payload}.${sig}`
}

/** Verifica assinatura do token. Retorna true/false. */
export function verifyVisitToken(token: string): boolean {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const [shortId, nonce, sig] = parts
    const expected = createHmac('sha256', getSecret())
      .update(`${shortId}.${nonce}`)
      .digest('base64url')
      .slice(0, 16)
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}
