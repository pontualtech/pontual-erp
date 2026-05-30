import { NextRequest } from 'next/server'
import { publicProxyHandler } from '@/lib/public-proxy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/site/equipamentos
 * Proxy público pro /api/bot/equipamentos (sem key, com rate limit + origin check).
 * Site pontualtech.com.br usa pra popular dropdown de tipos+marcas no form.
 */
export async function GET(req: NextRequest) {
  return publicProxyHandler(req, '/api/bot/equipamentos', { rlMax: 60 })
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
