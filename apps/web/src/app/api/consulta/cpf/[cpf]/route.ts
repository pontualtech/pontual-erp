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
    const url = `https://api.cpfcnpj.com.br/${token}/1/${cpf}`
    console.log('[CPF API] Consultando:', url.replace(token, '***'))

    let res: Response
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      res = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
      })
      clearTimeout(timeout)
    } catch (fetchErr: any) {
      console.error('[CPF API] Fetch error:', fetchErr?.message || fetchErr)
      return error(`Erro de conexao com API CPF: ${fetchErr?.message || 'desconhecido'}`, 502)
    }

    let data: any
    try {
      const text = await res.text()
      console.log('[CPF API] Response:', res.status, text.slice(0, 200))
      data = JSON.parse(text)
    } catch {
      return error('Resposta invalida da API CPF', 502)
    }

    // API retorna status=1 para sucesso, status=0 para erro
    if (data.status === 1 || data.status === '1') {
      return success({
        legal_name: data.nome || '',
        document_number: cpf,
        situacao: data.situacao || data.situacao_cadastral || '',
        date_of_birth: data.data_nascimento || null,
      })
    }

    // Erros conhecidos
    if (data.erroCodigo === 100 || data.erroCodigo === 101) {
      return error('CPF invalido', 400)
    }
    if (data.erroCodigo === 1000) {
      return error('Token da API CPF invalido ou IP nao autorizado', 401)
    }
    if (data.erroCodigo === 102) {
      return error('CPF nao encontrado na base de dados', 404)
    }
    // Créditos insuficientes ou saldo zerado
    if (data.erro?.toLowerCase().includes('cr') && data.erro?.toLowerCase().includes('insuficiente')) {
      return error('Creditos da API CPF esgotados. Recarregue em cpfcnpj.com.br', 402)
    }
    return error(data.erro || 'Erro na consulta CPF', 400)
  } catch (err: any) {
    console.error('[CPF API] Unexpected error:', err)
    if (err?.name === 'AbortError') {
      return error('Timeout na consulta CPF. Tente novamente.', 504)
    }
    return handleError(err)
  }
}
