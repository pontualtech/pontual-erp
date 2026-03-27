import { NextRequest } from 'next/server'
import { success, error, handleError } from '@/lib/api-response'

export async function GET(
  _req: NextRequest,
  { params }: { params: { cnpj: string } }
) {
  try {
    const cnpj = params.cnpj.replace(/\D/g, '')
    if (cnpj.length !== 14) return error('CNPJ inválido — deve ter 14 dígitos', 400)

    // Try ReceitaWS first, then cnpj.ws as fallback
    const result = await tryReceitaWS(cnpj) || await tryCnpjWs(cnpj)

    if (!result) return error('CNPJ não encontrado ou APIs indisponíveis', 404)
    return success(result)
  } catch (err) {
    return handleError(err)
  }
}

async function tryReceitaWS(cnpj: string) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    })
    clearTimeout(timeout)

    if (!res.ok) return null
    const d = await res.json()
    if (d.status === 'ERROR') return null

    return {
      legal_name: d.nome || '',
      trade_name: d.fantasia || '',
      email: d.email || '',
      phone: d.telefone || '',
      address_zip: d.cep ? d.cep.replace(/\D/g, '') : '',
      address_street: d.logradouro || '',
      address_number: d.numero || '',
      address_complement: d.complemento || '',
      address_neighborhood: d.bairro || '',
      address_city: d.municipio || '',
      address_state: d.uf || '',
      situacao: d.situacao || '',
      atividade_principal: d.atividade_principal?.[0]?.text || '',
    }
  } catch {
    return null
  }
}

async function tryCnpjWs(cnpj: string) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeout)

    if (!res.ok) return null
    const d = await res.json()
    const est = d.estabelecimento || {}

    return {
      legal_name: d.razao_social || '',
      trade_name: est.nome_fantasia || '',
      email: est.email || '',
      phone: est.ddd1 && est.telefone1 ? `(${est.ddd1}) ${est.telefone1}` : '',
      address_zip: est.cep ? String(est.cep).replace(/\D/g, '') : '',
      address_street: est.logradouro || '',
      address_number: est.numero || '',
      address_complement: est.complemento || '',
      address_neighborhood: est.bairro || '',
      address_city: est.cidade?.nome || '',
      address_state: est.estado?.sigla || '',
      situacao: est.situacao_cadastral || '',
      atividade_principal: est.atividade_principal?.descricao || '',
    }
  } catch {
    return null
  }
}
