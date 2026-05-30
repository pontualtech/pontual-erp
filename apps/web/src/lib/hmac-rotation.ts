import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Eco audit A (2026-05-30): helper centralizado pra HMAC com fallback
 * de chave antiga durante rotação da ENCRYPTION_KEY.
 *
 * Uso:
 *   - sign(payload, 'context'): sempre usa ENCRYPTION_KEY (nova)
 *   - verify(payload, 'context', sig): tenta NEW, fallback OLD se presente
 *
 * Contextos usados no projeto:
 *   - portal-auth: 'portal' (cookie 7d) e 'access' (magic link 30d) — coberto
 *     direto em lib/portal-auth.ts
 *   - orcamento: 'orcamento:{osId}' — portal/orcamento/[id] HMAC truncado 16 chars
 *   - cobranca/lembrete: similar
 *   - visit-token: HMAC visita técnica
 *   - google-oauth: state nonce
 */

function getNewSecret(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY não configurada')
  return key
}

function getOldSecret(): string | null {
  return process.env.ENCRYPTION_KEY_OLD || null
}

/**
 * Assina payload com HMAC-SHA256. Sempre usa NEW key.
 * @param payload string a assinar
 * @param contextSuffix opcional, prepended ao secret pra namespace tokens
 *                     (ex: 'orcamento:{osId}', ':access')
 * @param truncate número de hex chars a retornar (default = full 64)
 */
export function hmacSign(payload: string, contextSuffix = '', truncate?: number): string {
  const secret = getNewSecret() + contextSuffix
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return truncate ? sig.slice(0, truncate) : sig
}

/**
 * Verifica HMAC — tenta NEW primeiro, fallback OLD se em rotação.
 * Constant-time comparison via timingSafeEqual.
 * @returns true se signature confere com NEW ou OLD
 */
export function hmacVerify(
  payload: string,
  signature: string,
  contextSuffix = '',
  truncate?: number,
): boolean {
  const trySecret = (secret: string): boolean => {
    const expected = createHmac('sha256', secret).update(payload).digest('hex')
    const expectedFinal = truncate ? expected.slice(0, truncate) : expected
    if (signature.length !== expectedFinal.length) return false
    try {
      return timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedFinal, 'hex'),
      )
    } catch {
      // Buffer.from inválido (signature não-hex válido)
      return false
    }
  }

  // Tenta NEW
  if (trySecret(getNewSecret() + contextSuffix)) return true

  // Fallback OLD (durante janela de rotação)
  const oldSecret = getOldSecret()
  if (oldSecret && trySecret(oldSecret + contextSuffix)) {
    if (Math.random() < 0.01) {
      console.warn(`[HMAC] Verify usou ENCRYPTION_KEY_OLD (context=${contextSuffix.slice(0, 30)}) — rotação ativa`)
    }
    return true
  }

  return false
}
