import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * UX-4 #10: ingest de erros do React error boundary do client.
 * Loga estruturado pra Coolify ler stdout. Próximo passo seria persistir em
 * `client_errors` com partição mensal + alerta quando spike detectado.
 *
 * Aceita beacon (sem auth — telemetry pública). Anti-abuso: rate-limit
 * no proxy se virar problema.
 */
export async function POST(req: NextRequest) {
  try {
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
