/**
 * Tokens assinados pra compartilhamento publico de gravacoes.
 *
 * HMAC-SHA256 sobre `voipCallId.expiresAt`. Sem schema change — stateless.
 * Validade default 7 dias.
 */

import crypto from 'crypto'

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getSecret(): string {
  return (
    process.env.RECORDING_SHARE_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.JWT_SECRET ||
    ''
  )
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Buffer {
  const pad = (4 - (s.length % 4)) % 4
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad), 'base64')
}

export interface ShareTokenPayload {
  callId: string
  exp: number
}

export function signShareToken(callId: string, ttlMs = DEFAULT_TTL_MS): string {
  const secret = getSecret()
  if (!secret) throw new Error('share-token secret nao configurado')
  const payload: ShareTokenPayload = { callId, exp: Date.now() + ttlMs }
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest())
  return `${body}.${sig}`
}

export function verifyShareToken(token: string): ShareTokenPayload | null {
  try {
    const [body, sig] = token.split('.')
    if (!body || !sig) return null
    const secret = getSecret()
    if (!secret) return null
    const expected = b64url(crypto.createHmac('sha256', secret).update(body).digest())
    // Constant-time compare
    if (expected.length !== sig.length) return null
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as ShareTokenPayload
    if (!payload.callId || typeof payload.exp !== 'number') return null
    if (Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}
