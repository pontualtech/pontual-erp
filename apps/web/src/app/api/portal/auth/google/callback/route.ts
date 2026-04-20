import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createAccessToken } from '@/lib/portal-auth'
import { createHmac, timingSafeEqual } from 'crypto'

const STATE_MAX_AGE_MS = 10 * 60 * 1000 // 10 min

function verifyState(state: string): { slug: string; redirect: string; nonce: string; iat: number } | null {
  try {
    const [payloadB64, sig] = state.split('.')
    if (!payloadB64 || !sig) return null
    const secret = process.env.PORTAL_AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-secret'
    const expected = createHmac('sha256', secret + ':google-state').update(payloadB64).digest('base64url')
    const sigBuf = Buffer.from(sig)
    const expBuf = Buffer.from(expected)
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (!payload.iat || Date.now() - payload.iat > STATE_MAX_AGE_MS) return null
    return payload
  } catch {
    return null
  }
}

// GET /api/portal/auth/google/callback?code=...&state=...
// Handles Google OAuth callback: exchanges code for token, finds customer, creates session
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const error = searchParams.get('error')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'

  function redirectToLogin(slug: string, errMsg: string) {
    const isImpri = slug.includes('imprimitech')
    const portalDomain = isImpri ? 'https://portal.imprimitech.com.br' : 'https://portal.pontualtech.com.br'
    const loginUrl = new URL(`${portalDomain}/portal/${slug}/login`)
    loginUrl.searchParams.set('error', errMsg)
    return NextResponse.redirect(loginUrl.toString())
  }

  if (error) return redirectToLogin('pontualtech', `google_${error}`)
  if (!code || !stateParam) return redirectToLogin('pontualtech', 'google_no_code')

  // CSRF + integrity check: HMAC-signed state (stateless, works across domains)
  const state = verifyState(stateParam)
  if (!state) return redirectToLogin('pontualtech', 'google_bad_state')

  // Per-tenant client credentials
  const slugUpper = state.slug.toUpperCase().replace(/-/g, '_')
  const clientId =
    process.env[`GOOGLE_CLIENT_ID_${slugUpper}`] || process.env.GOOGLE_CLIENT_ID
  const clientSecret =
    process.env[`GOOGLE_CLIENT_SECRET_${slugUpper}`] || process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return redirectToLogin(state.slug, 'google_not_configured')
  }

  // Exchange code for access token
  const redirectUri = `${appUrl}/api/portal/auth/google/callback`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    console.error('[Google OAuth] token exchange failed:', await tokenRes.text())
    return redirectToLogin(state.slug, 'google_token_error')
  }

  const tokenData = await tokenRes.json()
  const googleAccessToken = tokenData.access_token as string

  // Get user info from Google
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${googleAccessToken}` },
  })

  if (!userRes.ok) {
    return redirectToLogin(state.slug, 'google_userinfo_error')
  }

  const googleUser = await userRes.json() as {
    email: string
    verified_email: boolean
    name: string
    picture?: string
  }

  if (!googleUser.email || !googleUser.verified_email) {
    return redirectToLogin(state.slug, 'google_unverified_email')
  }

  // Find company + customer
  const company = await prisma.company.findUnique({ where: { slug: state.slug } })
  if (!company) return redirectToLogin(state.slug, 'company_not_found')

  const customer = await findCustomerByEmail(company.id, googleUser.email)

  if (!customer) {
    return redirectToLogin(state.slug, 'email_not_registered')
  }

  // Ensure CustomerAccess exists
  let access = await prisma.customerAccess.findUnique({
    where: {
      company_id_customer_id: { company_id: company.id, customer_id: customer.id },
    },
  })
  if (!access) {
    access = await prisma.customerAccess.create({
      data: {
        company_id: company.id,
        customer_id: customer.id,
        password_hash: '', // no password — OAuth-only login
        email_verified: true, // Google verified the email for us
      },
    })
  } else if (!access.email_verified) {
    await prisma.customerAccess.update({
      where: { id: access.id },
      data: { email_verified: true, last_login_at: new Date() },
    })
  } else {
    await prisma.customerAccess.update({
      where: { id: access.id },
      data: { last_login_at: new Date() },
    })
  }

  // Generate a magic-link access token and redirect to the tenant's portal /entrar page.
  // The /entrar page runs on the portal domain and sets the portal_token cookie there,
  // which is required because cookies don't cross different eTLD+1 domains.
  const accessToken = createAccessToken(customer.id, company.id)

  const isImpri = state.slug.includes('imprimitech')
  const portalDomain = isImpri ? 'https://portal.imprimitech.com.br' : 'https://portal.pontualtech.com.br'

  const entryUrl = new URL(`${portalDomain}/portal/${state.slug}/entrar`)
  entryUrl.searchParams.set('t', accessToken)
  if (state.redirect) entryUrl.searchParams.set('r', state.redirect)

  return NextResponse.redirect(entryUrl.toString())
}

/**
 * Finds a customer by email within a specific company using case-insensitive match.
 * Strategy chosen: (B) — handles "Email@gmail.com" vs "email@gmail.com" variations,
 * which is the most common cadastro inconsistency.
 */
async function findCustomerByEmail(companyId: string, googleEmail: string) {
  return prisma.customer.findFirst({
    where: {
      company_id: companyId,
      email: { equals: googleEmail, mode: 'insensitive' },
      deleted_at: null,
    },
  })
}
