import { NextRequest } from 'next/server'
import { success, error, handleError } from '@/lib/api-response'

export async function GET(
  _req: NextRequest,
  { params }: { params: { cnpj: string } }
) {
  try {
    const cnpj = params.cnpj.replace(/\D/g, '')
    if (cnpj.length !== 14) return error('CNPJ inválido — deve ter 14 dígitos', 400)

    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      next: { revalidate: 86400 },
    })

    if (!res.ok) {
      if (res.status === 404) return error('CNPJ não encontrado na Receita Federal', 404)
      return error('Erro ao consultar CNPJ', 502)
    }

    const data = await res.json()

    return success({
      legal_name: data.razao_social || '',
      trade_name: data.nome_fantasia || '',
      email: data.email || '',
      phone: data.ddd_telefone_1
        ? `(${data.ddd_telefone_1.substring(0, 2)}) ${data.ddd_telefone_1.substring(2)}`
        : '',
      address_zip: data.cep ? data.cep.replace(/\D/g, '') : '',
      address_street: data.logradouro || '',
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
