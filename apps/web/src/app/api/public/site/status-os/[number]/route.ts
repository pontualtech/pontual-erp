import { NextRequest, NextResponse } from 'next/server'
import { gateRequest, forwardToBot } from '@/lib/public-proxy'
import { toPublicOsStatus } from '@/lib/public-os-status'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/site/status-os/[number]
 * Proxy público pro /api/bot/status-os/[number] — cliente consulta status
 * da própria OS via site público. Rate limit 30/min (consulta legítima).
 * 2026-10-12: resposta passa por lista branca (lib/public-os-status) — antes vazava dados
 * pessoais do cliente e notas internas. Falha fechada: nunca devolve a resposta crua do bot.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { number: string } },
) {
  const gate = gateRequest(req, 30)
  if (!gate.allowed) {
    return NextResponse.json({ ok: false, erro: gate.reason }, { status: gate.status || 403 })
  }
  const upstream = await forwardToBot(req, `/api/bot/status-os/${params.number}`)
  const cors = { 'access-control-allow-origin': 'https://pontualtech.com.br' }
  try {
    const data = await upstream.json()
    return NextResponse.json(toPublicOsStatus(data), { status: upstream.status, headers: cors })
  } catch {
    return NextResponse.json({ ok: false, erro: 'Erro ao consultar OS' }, { status: 502, headers: cors })
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
