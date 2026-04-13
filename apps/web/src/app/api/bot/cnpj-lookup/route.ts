import { NextRequest } from 'next/server'
import { authenticateBot } from '../_lib/auth'
import { NextResponse } from 'next/server'

/**
 * GET /api/bot/cnpj-lookup?cnpj=32772178000147
 * Returns company data from ReceitaWS (free tier).
 * Auth: X-Bot-Key header
 */
export async function GET(req: NextRequest) {
  const auth = authenticateBot(req)
  if (auth instanceof NextResponse) return auth

  const cnpj = (req.nextUrl.searchParams.get('cnpj') || '').replace(/\D/g, '')
  if (!cnpj || cnpj.length !== 14) {
    return NextResponse.json({ ok: false, erro: 'CNPJ invalido (14 digitos)' }, { status: 400 })
  }

  try {
    const res = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json()

    if (data.status === 'ERROR') {
      return NextResponse.json({ ok: false, erro: data.message || 'CNPJ nao encontrado' }, { status: 404 })
    }

    return NextResponse.json({
      ok: true,
      cnpj: data.cnpj,
      razao_social: data.nome || '',
      nome_fantasia: data.fantasia || '',
      logradouro: data.logradouro || '',
      numero: data.numero || '',
      complemento: data.complemento || '',
      bairro: data.bairro || '',
      cidade: data.municipio || '',
      uf: data.uf || '',
      cep: (data.cep || '').replace(/\D/g, ''),
      telefone: data.telefone || '',
      email: data.email || '',
      situacao: data.situacao || '',
    })
  } catch {
    return NextResponse.json({ ok: false, erro: 'Erro ao consultar CNPJ' }, { status: 500 })
  }
}
