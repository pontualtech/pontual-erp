import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { getAuthorizeUrl } from '@/lib/google-business'

/** GET /api/integracoes/google-business/connect — inicia OAuth. */
export async function GET(_req: NextRequest) {
  const result = await requirePermission('config', 'edit')
  if (result instanceof NextResponse) return result
  const user = result

  const url = await getAuthorizeUrl(user.companyId)
  if (!url) {
    return NextResponse.json({
      error: 'OAuth nao configurado — precisa GOOGLE_CLIENT_ID_<empresa> e _SECRET nas envs ou settings gbp.client_id e gbp.client_secret',
    }, { status: 400 })
  }
  return NextResponse.redirect(url, 302)
}
