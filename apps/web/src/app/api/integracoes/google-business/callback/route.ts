import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode } from '@/lib/google-business'

/**
 * GET /api/integracoes/google-business/callback?code=X&state=<companyId>
 * Sem auth — eh callback publico do Google. Valida state pra identificar
 * a empresa. Redireciona pra /config/google-business apos trocar tokens.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(
      `${url.origin}/config/google-business?error=${encodeURIComponent(error)}`, 302)
  }
  if (!code || !state) {
    return NextResponse.redirect(
      `${url.origin}/config/google-business?error=missing_code_or_state`, 302)
  }

  const result = await exchangeCode(state, code)
  if (!result.success) {
    return NextResponse.redirect(
      `${url.origin}/config/google-business?error=${encodeURIComponent(result.error || 'exchange_failed')}`, 302)
  }
  return NextResponse.redirect(`${url.origin}/config/google-business?connected=1`, 302)
}
