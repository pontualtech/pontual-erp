import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

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

  // CSRF protection: signed state with slug + nonce + optional redirect
  const nonce = randomBytes(16).toString('hex')
  const statePayload = JSON.stringify({ slug, redirect, nonce })
  const state = Buffer.from(statePayload).toString('base64url')

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid email profile')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('prompt', 'select_account')
  authUrl.searchParams.set('access_type', 'online')

  // Store nonce in short-lived cookie for CSRF validation on callback
  const response = NextResponse.redirect(authUrl.toString())
  response.cookies.set('g_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60, // 10 minutes
    path: '/',
  })

  return response
}
