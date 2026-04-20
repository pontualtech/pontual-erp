import { NextRequest } from 'next/server'

/**
 * Allowed Origin/Referer hosts for state-changing portal requests.
 * Keep in sync with middleware.ts PORTAL_HOST_SLUG + the ERP host.
 */
const ALLOWED_ORIGINS = [
  'https://portal.pontualtech.com.br',
  'https://portal.imprimitech.com.br',
  'https://erp.pontualtech.work',
]

/**
 * Returns true if the request's Origin or Referer header matches an allowlisted
 * portal/ERP domain. GET requests and unauthenticated (no cookie) requests are
 * always allowed — this is pure CSRF defense-in-depth.
 *
 * SameSite=Lax already blocks classic cross-site form POSTs, but relying on
 * SameSite alone means any XSS on a sibling subdomain or a misconfigured
 * browser could still forge a state-changing request. Origin check closes
 * the gap for every POST/PATCH/DELETE on the portal API surface.
 */
export function isAllowedOrigin(req: NextRequest): boolean {
  const method = req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true

  const origin = req.headers.get('origin') || ''
  const referer = req.headers.get('referer') || ''
  const source = origin || referer

  if (!source) {
    // No Origin/Referer — in modern browsers this only happens for
    // navigations initiated by the address bar, opaque contexts, or
    // server-to-server calls. For a session-cookie-authenticated POST
    // we should reject.
    return false
  }

  try {
    const url = new URL(source)
    const reqOrigin = `${url.protocol}//${url.host}`
    return ALLOWED_ORIGINS.includes(reqOrigin)
  } catch {
    return false
  }
}
