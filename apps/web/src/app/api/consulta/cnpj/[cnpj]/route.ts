import { NextRequest } from 'next/server'
import { success, error, handleError } from '@/lib/api-response'

export async function GET(
  _req: NextRequest,
  { params }: { params: { cnpj: string } }
) {
  try {
    const cnpj = params.cnpj.replace(/\D/g, '')
    if (cnpj.length !== 14) return error('CNPJ inválido — deve ter 14 dígitos', 400)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    let data: any
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      clearTimeout(timeout)

      if (!res.ok) {
        if (res.status === 404) return error('CNPJ não encontrado na Receita Federal', 404)
        return error(`Erro ao consultar CNPJ (status ${res.status})`, 502)
      }

      data = await res.json()
    } catch (fetchErr: any) {
      clearTimeout(timeout)
      if (fetchErr?.name === 'AbortError') {
        return error('Consulta CNPJ expirou (timeout). Tente novamente.', 504)
      }
      console.error('[CNPJ API] Fetch error:', fetchErr?.message)
      return error('Erro de conexão ao consultar CNPJ', 502)
    }

    // Format phone - BrasilAPI returns ddd+number together like "1134939002"
    let phone = ''
    const rawPhone = data.ddd_telefone_1 ? String(data.ddd_telefone_1).replace(/\D/g, '') : ''
    if (rawPhone.length >= 10) {
      phone = `(${rawPhone.substring(0, 2)}) ${rawPhone.substring(2)}`
    } else if (rawPhone.length > 0) {
      phone = rawPhone
    }

    return success({
      legal_name: data.razao_social || '',
      trade_name: data.nome_fantasia || '',
      email: (data.email && data.email !== 'null') ? data.email : '',
      phone,
      address_zip: data.cep ? String(data.cep).replace(/\D/g, '') : '',
      address_street: data.descricao_tipo_de_logradouro
        ? `${data.descricao_tipo_de_logradouro} ${data.logradouro || ''}`
        : (data.logradouro || ''),
      address_number: data.numero || '',
      address_complement: data.complemento || '',
      address_neighborhood: data.bairro || '',
      address_city: data.municipio || '',
      address_state: data.uf || '',
      situacao: data.descricao_situacao_cadastral || '',
      atividade_principal: data.cnae_fiscal_descricao || '',
    })
  } catch (err) {
    return handleError(err)
  }
}
