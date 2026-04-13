import { NextRequest } from 'next/server'
import { authenticateBot } from '../_lib/auth'
import { NextResponse } from 'next/server'

/**
 * GET /api/bot/cep-lookup?cep=04044060
 * Returns address data from ViaCEP API.
 * Auth: X-Bot-Key header
 */
export async function GET(req: NextRequest) {
  const auth = authenticateBot(req)
  if (auth instanceof NextResponse) return auth

  const cep = (req.nextUrl.searchParams.get('cep') || '').replace(/\D/g, '')
  if (!cep || cep.length !== 8) {
    return NextResponse.json({ ok: false, erro: 'CEP invalido (8 digitos)' }, { status: 400 })
  }

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(5000) })
    const data = await res.json()

    if (data.erro) {
      return NextResponse.json({ ok: false, erro: 'CEP nao encontrado' }, { status: 404 })
    }

    return NextResponse.json({
      ok: true,
      cep: data.cep,
      logradouro: data.logradouro || '',
      complemento: data.complemento || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      uf: data.uf || '',
    })
  } catch {
    return NextResponse.json({ ok: false, erro: 'Erro ao consultar CEP' }, { status: 500 })
  }
}
