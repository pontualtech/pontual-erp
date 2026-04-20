import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHmac } from 'crypto'

function signState(payload: string): string {
  const secret = process.env.PORTAL_AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-secret'
  return createHmac('sha256', secret + ':google-state').update(payload).digest('base64url')
}

// GET /api/portal/auth/google?slug={company_slug}&redirect={path}
// Redirects user to Google OAuth consent screen
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug')
  const redirect = searchParams.get('redirect') || ''

  if (!slug) {
    return NextResponse.json({ error: 'Empresa nao informada' }, { status: 400 })
  }

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
  const payload = JSON.stringify({ slug, redirect, nonce, iat: Date.now() })
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
