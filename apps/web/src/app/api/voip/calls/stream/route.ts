/**
 * GET /api/voip/calls/stream — SSE stream com eventos de chamadas em tempo real.
 *
 * Cada user autenticado abre uma conexão persistente. Os webhooks Sonax
 * (call-start, disconnect) emitem eventos no eventBus in-process; este endpoint
 * filtra por company_id do user e empurra como Server-Sent Events.
 *
 * Notas:
 * - Runtime nodejs (precisamos do EventEmitter; edge não suporta).
 * - Heartbeat a cada 25s pra manter a conexão viva atrás de proxies.
 * - Cleanup do listener quando o client desconecta (evita leak).
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { subscribeVoipEvents, type VoipEvent } from '@/lib/voip/eventBus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireAuth()
  } catch {
    return new Response('Unauthorized', { status: 401 })
  }

  const companyId = user.companyId
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // controller já fechado
        }
      }

      // Hello inicial pro client confirmar conexão
      send({ type: 'hello', ts: Date.now() })

      const handler = (ev: VoipEvent) => {
        if (ev.companyId !== companyId) return
        send(ev)
      }

      const unsubscribe = subscribeVoipEvents(handler)

      // Heartbeat a cada 25s pra evitar timeout do proxy
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`))
        } catch {
          clearInterval(heartbeat)
        }
      }, 25_000)

      // Cleanup quando o client desconecta
      const onAbort = () => {
        clearInterval(heartbeat)
        unsubscribe()
        try { controller.close() } catch {}
      }
      req.signal.addEventListener('abort', onAbort)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // desliga buffering em proxies tipo nginx
    },
  })
}
