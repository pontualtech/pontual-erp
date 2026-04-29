import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { RedeApiClient } from '@/lib/acquirer/rede-api-client'

/**
 * POST /api/financeiro/maquininha/opt-in-rede
 *
 * Dispara solicitacao de Opt-in pra Rede consumir vendas do estabelecimento
 * via API. Apos sucesso, Karlao precisa aprovar no portal:
 *   meu.userede.com.br > Minha Rede > PV {parentCompanyNumber} >
 *   Conciliacao > Compartilhar
 *
 * Delay de ate 1h pra aparecer no portal.
 *
 * Body opcional: { parent_company_number?: string }
 *   default: env REDE_PARENT_COMPANY_NUMBER
 *
 * Permission: financeiro.edit
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const parentCompanyNumber = body.parent_company_number || process.env.REDE_PARENT_COMPANY_NUMBER || ''
    if (!parentCompanyNumber) {
      return error('parent_company_number obrigatorio (ou configure REDE_PARENT_COMPANY_NUMBER)', 400)
    }

    const client = new RedeApiClient()
    if (!client.isConfigured()) {
      return error('REDE_CLIENT_ID/SECRET nao configurado no env', 503)
    }

    const r = await client.requestOptIn(parentCompanyNumber)

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'rede_opt_in',
      newValue: { parentCompanyNumber, status: r.status, ok: r.ok, path: r.path },
    })

    if (!r.ok) {
      return error(
        `Opt-in retornou ${r.status} em ${r.path}. Body: ${JSON.stringify(r.body).substring(0, 300)}`,
        r.status === 404 ? 502 : 502,
      )
    }

    return success({
      ok: true,
      parent_company_number: parentCompanyNumber,
      asaas_status: r.status,
      response: r.body,
      next_steps: [
        'Aguardar ate 1h pro Opt-in constar no portal Rede',
        'Logar em meu.userede.com.br com perfil master',
        'Ir em: Minha Rede > PV ' + parentCompanyNumber + ' > Conciliacao',
        'Clicar em "Compartilhar" pra aprovar',
        'Apos aprovacao, API de vendas comeca a retornar dados reais',
      ],
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * GET /api/financeiro/maquininha/opt-in-rede
 *
 * Consulta status atual do Opt-in. Permite acompanhar se ja foi aprovado
 * antes de tentar usar a API de vendas.
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result

    const sp = req.nextUrl.searchParams
    const parentCompanyNumber = sp.get('parent_company_number') || process.env.REDE_PARENT_COMPANY_NUMBER || ''
    if (!parentCompanyNumber) {
      return error('parent_company_number obrigatorio', 400)
    }

    const client = new RedeApiClient()
    if (!client.isConfigured()) {
      return error('REDE_CLIENT_ID/SECRET nao configurado no env', 503)
    }

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
