import { NextRequest, NextResponse } from 'next/server'
import { gateRequest, forwardToBot } from '@/lib/public-proxy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/site/consultar?busca=<cpf|cnpj>
 *
 * Proxy público pro /api/bot/consultar, MAS com PII REDUCED — endpoint
 * público nunca retorna dados completos do cliente. Risk: lookup CPF
 * permitia confirmar existência + ler dados pessoais. Agora retorna
 * apenas { ok, total, ordens: [{os_number, cliente_nome_first_only}] }.
 *
 * Rate limit reduzido (5/min) — anti-enumeração de CPFs.
 */
export async function GET(req: NextRequest) {
  const gate = gateRequest(req, 5)
  if (!gate.allowed) {
    return NextResponse.json({ ok: false, erro: gate.reason }, { status: gate.status || 403 })
  }

  const upstream = await forwardToBot(req, '/api/bot/consultar')
  if (!upstream.ok) return upstream

  // Sanitiza PII antes de devolver ao site público
  try {
    const data = await upstream.json()
    if (data.ok && data.cliente) {
      // Retorna apenas first name pra confirmar existência
      const fullName = String(data.cliente.nome || '')
      const firstName = fullName.split(' ')[0] || ''
      data.cliente = {
        nome: firstName,
        // PII removido: telefone, email, endereco, etc
        existe: true,
      }
    }
    if (data.ordens) {
      data.ordens = data.ordens.map((os: any) => ({
        os_number: os.os_number,
        // Não retorna documento, telefone, email, endereco
        cliente_nome: String(os.cliente_nome || '').split(' ')[0],
      }))
    }
    return NextResponse.json(data, {
      status: 200,
      headers: { 'access-control-allow-origin': 'https://pontualtech.com.br' },
    })
  } catch {
    return upstream
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': 'https://pontualtech.com.br',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  })
}
