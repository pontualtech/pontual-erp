import { NextRequest } from 'next/server'
import { publicProxyHandler } from '@/lib/public-proxy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/site/status-os/[number]
 * Proxy público pro /api/bot/status-os/[number] — cliente consulta status
 * da própria OS via site público. Rate limit 30/min (consulta legítima).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { number: string } },
) {
  return publicProxyHandler(req, `/api/bot/status-os/${params.number}`, { rlMax: 30 })
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
