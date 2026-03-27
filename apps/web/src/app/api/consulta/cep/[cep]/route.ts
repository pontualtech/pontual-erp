import { NextRequest } from 'next/server'
import { success, error, handleError } from '@/lib/api-response'

export async function GET(
  _req: NextRequest,
  { params }: { params: { cep: string } }
) {
  try {
    const cep = params.cep.replace(/\D/g, '')
    if (cep.length !== 8) return error('CEP inválido — deve ter 8 dígitos', 400)

    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      next: { revalidate: 86400 },
    })

    if (!res.ok) return error('Erro ao consultar CEP', 502)

    const data = await res.json()
    if (data.erro) return error('CEP não encontrado', 404)

    return success({
      address_street: data.logradouro || '',
      address_neighborhood: data.bairro || '',
      address_city: data.localidade || '',
      address_state: data.uf || '',
      address_complement: data.complemento || '',
    })
  } catch (err) {
    return handleError(err)
  }
}
