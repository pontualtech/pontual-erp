/**
 * POST /api/voip/calls/[id]/share
 *
 * Gera URL publica assinada pra compartilhar a gravacao da chamada.
 * Token HMAC com TTL (default 7 dias). URL fica acessivel sem auth.
 *
 * Auth: requireAuth + same-tenant.
 *
 * Resposta: { url, expiresAt }
 */

import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requireAuth } from '@/lib/auth'
import { error, handleError, success } from '@/lib/api-response'
import { signShareToken } from '@/lib/voip/share-token'

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireAuth()

    const body = await req.json().catch(() => ({}))
    const ttlDays = Math.max(1, Math.min(30, parseInt(String(body.ttl_days ?? 7))))
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000

    const call = await prisma.voipCall.findFirst({
      where: { id: params.id, company_id: user.companyId },
      select: { id: true, recording_url: true },
    })
    if (!call) return error('Chamada nao encontrada', 404)
    if (!call.recording_url) return error('Sem gravacao disponivel', 404)

    const token = signShareToken(call.id, ttlMs)
    const origin = req.headers.get('origin') || req.nextUrl.origin
    const url = `${origin}/api/voip/share/${token}/recording.mp3`
    const expiresAt = new Date(Date.now() + ttlMs).toISOString()

    return success({ url, expiresAt, ttl_days: ttlDays })
  } catch (e) {
    return handleError(e)
  }
}
