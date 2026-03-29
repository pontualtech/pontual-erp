import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { NextResponse } from 'next/server'

/**
 * GET /api/consulta/cpf/{cpf}
 * Consulta nome e situacao cadastral do CPF via API cpfcnpj.com.br
 * Requer token configurado em settings (key: cpf_api.token)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { cpf: string } }
) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const cpf = params.cpf.replace(/\D/g, '')
    if (cpf.length !== 11) return error('CPF invalido — deve ter 11 digitos', 400)

    // Verificar se a consulta CPF esta habilitada
    const enabledSetting = await prisma.setting.findFirst({
      where: { company_id: user.companyId, key: 'cpf_api.enabled' },
    })
    if (!enabledSetting || enabledSetting.value !== 'true') {
      return error('Consulta CPF nao habilitada. Ative em Configuracoes > Consulta CPF.', 403)
    }

    // Buscar token da API
    const tokenSetting = await prisma.setting.findFirst({
      where: { company_id: user.companyId, key: 'cpf_api.token' },
    })
    if (!tokenSetting || !tokenSetting.value) {
      return error('Token da API CPF nao configurado. Configure em Configuracoes > Consulta CPF.', 422)
    }

    const token = tokenSetting.value

    // Consultar API cpfcnpj.com.br
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(`https://api.cpfcnpj.com.br/${token}/1/${cpf}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    })
    clearTimeout(timeout)

    if (!res.ok) {
      return error('Erro ao consultar API CPF. Verifique seu token.', 502)
    }

    const data = await res.json()

    // API retorna status=1 para sucesso, status=0 para erro
    if (data.status !== 1 && data.status !== '1') {
      if (data.erroCodigo === 100 || data.erroCodigo === 101) {
        return error('CPF invalido', 400)
      }
      if (data.erroCodigo === 1000) {
        return error('Token da API CPF invalido ou expirado. Verifique em Configuracoes.', 401)
      }
      return error(data.erro || 'CPF nao encontrado', 404)
    }

    return success({
      legal_name: data.nome || '',
      document_number: cpf,
      situacao: data.situacao || data.situacao_cadastral || '',
      // A API basica retorna apenas nome e situacao
      // Campos extras se disponíveis (plano avançado)
      date_of_birth: data.data_nascimento || null,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return error('Timeout na consulta CPF. Tente novamente.', 504)
    }
    return handleError(err)
  }
}
