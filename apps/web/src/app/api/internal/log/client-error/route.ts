import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * UX-4 #10: ingest de erros do React error boundary do client.
 * Loga estruturado pra Coolify ler stdout. Próximo passo seria persistir em
 * `client_errors` com partição mensal + alerta quando spike detectado.
 *
 * Aceita beacon (sem auth — telemetry pública). Anti-abuso: rate-limit
 * no proxy se virar problema.
 */
// UX-10 #8: body size cap — stack trace + path + ua tipicamente < 8KB
const MAX_BODY_BYTES = 16384

export async function POST(req: NextRequest) {
  try {
    // UX-9 #8: rate limit por IP — 20 erros/min/IP é generoso pra crash real
    const ip = getClientIp(req)
    const { allowed } = rateLimit(`client-error:${ip}`, 20, 60_000)
    if (!allowed) return new NextResponse(null, { status: 429 })

    // UX-10 #8: cap de body antes de parse JSON
    const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
    if (contentLength > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 })

    const data = await req.json().catch(() => null)
    if (data && typeof data === 'object') {
      console.error('[client-error]', JSON.stringify({
        module: data.module,
        message: data.message,
        digest: data.digest,
        stack: data.stack?.slice(0, 500),
        path: data.path,
        ua: req.headers.get('user-agent')?.slice(0, 100),
      }))
    }
  } catch { /* swallow */ }
  return new NextResponse(null, { status: 204 })
}
