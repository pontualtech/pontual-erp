/**
 * GET /api/voip/_debug/webhook-hits
 *
 * Retorna os ultimos 50 hits brutos recebidos nos webhooks Sonax
 * (call-start + disconnect). Inclui IP, headers, query, body e outcome
 * (forbidden_ip, no_call_id, allowed, error).
 *
 * Util pra debug quando webhooks Sonax nao estao chegando ou estao
 * sendo rejeitados silenciosamente.
 *
 * Auth: requireAuth (qualquer user logado do tenant pode ver). Em
 * producão estavel poderiamos restringir a super admin.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handleError, success } from '@/lib/api-response'
import { getRecentWebhookHits } from '@/lib/voip/eventBus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  try {
    await requireAuth()
    const hits = getRecentWebhookHits()
    return success({
      total: hits.length,
      hits: hits.map(h => ({
        ts: h.ts,
        endpoint: h.endpoint,
        ip: h.ip,
        outcome: h.outcome,
        error: h.error,
        // Headers reduzidos: deixa só os úteis pra não vazar auth/cookies
        contentType: h.headers['content-type'],
        userAgent: h.headers['user-agent']?.slice(0, 80),
        forwardedFor: h.headers['x-forwarded-for'],
        realIp: h.headers['x-real-ip'],
        query: h.query,
        body: h.body,
      })),
    })
  } catch (e) {
    return handleError(e)
  }
}
