import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

export interface PortalUser {
  customer_id: string
  company_id: string
  exp: number
}

const COOKIE_NAME = 'portal_token'

function getSecret(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY nao configurada')
  return key
}

/**
 * Cria token para o portal do cliente
 * Formato: base64(payload).hmac_signature
 */
export function createPortalToken(customerId: string, companyId: string): string {
  const payload: PortalUser = {
    customer_id: customerId,
    company_id: companyId,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 dias
  }

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url')

  return `${payloadB64}.${signature}`
}

/**
 * Verifica token do portal
 */
export function verifyPortalToken(token: string): PortalUser | null {
  try {
    const [payloadB64, signature] = token.split('.')
    if (!payloadB64 || !signature) return null

    const expectedSig = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url')
    const sigBuf = Buffer.from(signature)
    const expectedBuf = Buffer.from(expectedSig)
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null

    const payload: PortalUser = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    )

    if (payload.exp < Date.now()) return null

    return payload
  } catch {
    return null
  }
}

/**
 * Extrai e verifica token do request (cookie ou header)
 */
export function getPortalUserFromRequest(req: NextRequest): PortalUser | null {
  // Tentar cookie primeiro
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value
  if (cookieToken) {
    const user = verifyPortalToken(cookieToken)
    if (user) return user
  }

  // Tentar header Authorization
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    return verifyPortalToken(token)
  }

  return null
}

/**
 * Seta o cookie do portal token na response
 */
export function setPortalCookie(token: string): void {
  const cookieStore = cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 dias
    path: '/',
  })
}

// ─── Magic Access Token (auto-login via link) ───

interface AccessPayload {
  cid: string  // customer_id
  mid: string  // company_id
  exp: number
}

// A8 fix (audit): TTL reduzido de 5 anos pra 30 dias.
// Antes: token na URL (query string ?t=) com TTL 5 anos = credencial
// permanente — vazava em logs proxy/browser/screenshots/encaminhamentos.
// Cliente reclamava de spam, encaminhava email, atacante ganhava 5 anos
// de acesso ao portal daquele customer.
// Agora: 30 dias é UX aceitável (mesmo cliente reaberto após 30d gera novo
// link), e janela de exposição muito menor.
//
// Roadmap futuro (não fechado nesta auditoria):
//   - Endpoint /portal/refresh pra rotação silenciosa via cookie de sessão
//   - jti (token id) persistido em magic_link_revocations pra logout dispositivo
//   - Token em POST body em vez de query string (alguns flows)
//
// Revogação imediata hoje: customer.deleted_at — auto-login nega tokens de
// clientes deletados (ver /api/portal/auth/auto-login).
export const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 dias

/**
 * Gera token de acesso direto (magic link) para o portal.
 * Valido por 30 dias — cliente clica e entra sem login.
 * Após expirar, novo link é gerado pelo emisor (cobrança/notificação/etc).
 */
export function createAccessToken(customerId: string, companyId: string): string {
  const payload: AccessPayload = {
    cid: customerId,
    mid: companyId,
    exp: Date.now() + ACCESS_TOKEN_TTL_MS,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', getSecret() + ':access').update(payloadB64).digest('base64url')
  return `${payloadB64}.${signature}`
}

/**
 * Valida token de acesso direto e retorna payload.
 */
export function verifyAccessToken(token: string): AccessPayload | null {
  try {
    const [payloadB64, signature] = token.split('.')
    if (!payloadB64 || !signature) return null
    const expectedSig = createHmac('sha256', getSecret() + ':access').update(payloadB64).digest('base64url')
    const sigBuf = Buffer.from(signature)
    const expectedBuf = Buffer.from(expectedSig)
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null
    const payload: AccessPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
