import { NextRequest } from 'next/server'
import { publicProxyHandler } from '@/lib/public-proxy'

export const dynamic = 'force-dynamic'

/**
 * POST /api/public/site/upload-foto
 * Proxy público pro /api/bot/upload-foto com rate limit 5/min (anti-spam upload).
 * NOTE: multipart/form-data passa pelo forward via arrayBuffer — preserva binário.
 */
export async function POST(req: NextRequest) {
  return publicProxyHandler(req, '/api/bot/upload-foto', { rlMax: 5 })
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
