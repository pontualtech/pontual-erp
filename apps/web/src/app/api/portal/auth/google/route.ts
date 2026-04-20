import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHmac } from 'crypto'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

function getStateSecret(): string {
  // No 'dev-secret' fallback — a weak/default HMAC key lets an attacker forge
  // OAuth state and bypass CSRF. If neither env is set we fail closed.
  // ENCRYPTION_KEY is accepted as a last resort because portal-auth.ts already
  // uses it for portal token HMAC (so it IS configured in production and is a
  // real secret), and the ':google-state' context string prevents key reuse
  // between the two HMAC domains.
  const secret = process.env.PORTAL_AUTH_SECRET
    || process.env.NEXTAUTH_SECRET
    || process.env.ENCRYPTION_KEY
  if (!secret || secret.length < 16) {
    throw new Error('PORTAL_AUTH_SECRET/NEXTAUTH_SECRET/ENCRYPTION_KEY ausente ou fraco — Google OAuth desabilitado')
  }
  return secret
}

function signState(payload: string): string {
  return createHmac('sha256', getStateSecret() + ':google-state').update(payload).digest('base64url')
}

// GET /api/portal/auth/google?slug={company_slug}&redirect={path}
// Redirects user to Google OAuth consent screen
export async function GET(req: NextRequest) {
  // Rate limit the OAuth-init itself so an attacker can't hammer it to
  // enumerate which slugs are configured (via the 503 vs 307 response split)
  // or burn Google API quota.
  const ip = getClientIp(req)
  const rl = rateLimit(`google-init:${ip}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Muitas tentativas' }, { status: 429 })
  }

  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug')
  const redirect = searchParams.get('redirect') || ''

  if (!slug) {
    return NextResponse.json({ error: 'Empresa nao informada' }, { status: 400 })
  }

  // Defense against open-redirect-via-OAuth: only accept same-origin relative
  // paths in the `redirect` param. External URLs and protocol-relative URLs
  // are silently discarded.
  const safeRedirect = redirect.startsWith('/')
    && !redirect.startsWith('//')
    && !redirect.startsWith('/\\')
    ? redirect
    : ''

  // Per-tenant client_id: env var pattern GOOGLE_CLIENT_ID_{SLUG_UPPER}
  // Falls back to shared GOOGLE_CLIENT_ID if tenant-specific not set
  const slugUpper = slug.toUpperCase().replace(/-/g, '_')
  const clientId =
    process.env[`GOOGLE_CLIENT_ID_${slugUpper}`] || process.env.GOOGLE_CLIENT_ID

  if (!clientId) {
    return NextResponse.json(
      { error: 'Login com Google nao configurado para esta empresa' },
      { status: 503 }
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'
  const redirectUri = `${appUrl}/api/portal/auth/google/callback`

  // CSRF protection via HMAC-signed state (stateless, works across domains).
  // Payload includes issued-at (10 min window) instead of cookie-based nonce.
  const nonce = randomBytes(16).toString('hex')
  const payload = JSON.stringify({ slug, redirect: safeRedirect, nonce, iat: Date.now() })
  const payloadB64 = Buffer.from(payload).toString('base64url')
  const sig = signState(payloadB64)
  const state = `${payloadB64}.${sig}`

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid email profile')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('prompt', 'select_account')
  authUrl.searchParams.set('access_type', 'online')

  return NextResponse.redirect(authUrl.toString())
}
