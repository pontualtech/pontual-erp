import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'

/**
 * POST /api/internal/cron/voip-cleanup-stale-ringing
 *
 * Marca como `failed` chamadas em `ringing` antigas (sem disconnect webhook).
 * Ocorre quando o webhook disconnect da Sonax falha (rede instável, IP fora
 * da allowlist, etc) e a chamada fica visualmente travada na UI como "Tocando".
 *
 * Default: ringing > 30 minutos.
 *
 * Auth: X-Internal-Key (env INTERNAL_API_KEY).
 *
 * Body opcional: { older_than_minutes?: number  — janela mínima, default 30, max 1440 }
 */
export async function POST(req: NextRequest) {
  try {
    const internalKey = process.env.INTERNAL_API_KEY || ''
    const provided = req.headers.get('x-internal-key') || ''
    if (!internalKey || provided !== internalKey) return error('Unauthorized', 401)

    const body = await req.json().catch(() => ({}))
    const minutes = Math.max(5, Math.min(1440, parseInt(String(body.older_than_minutes ?? 30))))
    const cutoff = new Date(Date.now() - minutes * 60 * 1000)

    const result = await prisma.voipCall.updateMany({
      where: {
        status: 'ringing',
        created_at: { lt: cutoff },
      },
      data: {
        status: 'failed',
        ended_at: new Date(),
      },
    })

    return success({
      ok: true,
      updated: result.count,
      cutoff: cutoff.toISOString(),
      older_than_minutes: minutes,
    })
  } catch (err) {
    return handleError(err)
  }
}
