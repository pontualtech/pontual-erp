import { NextRequest } from 'next/server'
import { publicProxyHandler } from '@/lib/public-proxy'

export const dynamic = 'force-dynamic'

/**
 * POST /api/public/site/abrir-os
 * Proxy público pro /api/bot/abrir-os com rate limit 3/min (anti-spam OS).
 */
export async function POST(req: NextRequest) {
  return publicProxyHandler(req, '/api/bot/abrir-os', { rlMax: 3 })
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': 'https://pontualtech.com.br',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  })
}
