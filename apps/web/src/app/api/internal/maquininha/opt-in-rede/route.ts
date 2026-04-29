import { NextRequest } from 'next/server'
import { success, error, handleError } from '@/lib/api-response'
import { RedeApiClient } from '@/lib/acquirer/rede-api-client'

/**
 * POST /api/internal/maquininha/opt-in-rede
 * GET  /api/internal/maquininha/opt-in-rede
 *
 * Variante interna do opt-in pra disparar via curl + X-Internal-Key
 * (sem precisar cookie de user logado).
 *
 * Auth: X-Internal-Key (env INTERNAL_API_KEY).
 *
 * POST body: { parent_company_number?: string }
 * GET  query: ?parent_company_number=...
 */
function checkAuth(req: NextRequest) {
  const internalKey = process.env.INTERNAL_API_KEY || ''
  const provided = req.headers.get('x-internal-key') || ''
  if (!internalKey || provided !== internalKey) return error('Unauthorized', 401)
  return null
}

export async function POST(req: NextRequest) {
  try {
    const authErr = checkAuth(req)
    if (authErr) return authErr

    const body = await req.json().catch(() => ({}))
    const parentCompanyNumber = body.parent_company_number || process.env.REDE_PARENT_COMPANY_NUMBER || ''
    if (!parentCompanyNumber) return error('parent_company_number obrigatorio', 400)

    const client = new RedeApiClient()
    if (!client.isConfigured()) return error('REDE_CLIENT_ID/SECRET nao configurado', 503)

    const r = await client.requestOptIn(parentCompanyNumber)

    return success({
      ok: r.ok,
      parent_company_number: parentCompanyNumber,
      api_status: r.status,
      api_path: r.path,
      api_url: process.env.REDE_API_URL,
      response: r.body,
      next_steps: r.ok ? [
        'Aguardar ate 1h pra Opt-in constar no portal Rede',
        'Logar em meu.userede.com.br com perfil master',
        `Ir em: Minha Rede > PV ${parentCompanyNumber} > Conciliacao`,
        'Clicar em "Compartilhar" pra aprovar',
      ] : [
        `Opt-in retornou ${r.status} no path ${r.path}`,
        'Verificar se REDE_OPTIN_PATH esta correto (default: /gestao-acessos/v1/optin)',
        'Verificar credenciais e ambiente (REDE_API_URL=' + process.env.REDE_API_URL + ')',
      ],
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function GET(req: NextRequest) {
  try {
    const authErr = checkAuth(req)
    if (authErr) return authErr

    const sp = req.nextUrl.searchParams
    const parentCompanyNumber = sp.get('parent_company_number') || process.env.REDE_PARENT_COMPANY_NUMBER || ''
    if (!parentCompanyNumber) return error('parent_company_number obrigatorio', 400)

    const client = new RedeApiClient()
    if (!client.isConfigured()) return error('REDE_CLIENT_ID/SECRET nao configurado', 503)

    const r = await client.getOptInStatus(parentCompanyNumber)
    return success({
      ok: r.ok,
      parent_company_number: parentCompanyNumber,
      api_status: r.status,
      api_path: r.path,
      response: r.body,
    })
  } catch (err) {
    return handleError(err)
  }
}
