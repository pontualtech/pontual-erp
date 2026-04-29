import { NextRequest } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth'
import { prisma } from '@pontual/db'
import { error, handleError, success } from '@/lib/api-response'
import { emitVoipEvent } from '@/lib/voip/eventBus'

/**
 * POST /api/voip/calls/widget-end
 *
 * Fecha a chamada widget-dial em ringing mais recente do user logado.
 * Acionado client-side quando o widget Sonax sinaliza fim (localStorage clear).
 *
 * Body opcional: { duration_sec?, status? } — default: status=completed,
 * duration calculado a partir de started_at agora.
 *
 * Idempotente: se nao tem chamada pendurada, retorna { updated: 0 }.
 */

const Body = z.object({
  duration_sec: z.number().int().min(0).max(7200).optional(),
  status: z.enum(['answered', 'completed', 'no_answer', 'busy', 'failed']).optional(),
}).default({})

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const json = await req.json().catch(() => ({}))
    const body = Body.parse(json)

    // Pega a ultima chamada widget-dial em ringing deste usuario nas ultimas 4h
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000)
    const call = await prisma.voipCall.findFirst({
      where: {
        company_id: user.companyId,
        agent_user_id: user.id,
        status: 'ringing',
        created_at: { gte: cutoff },
        // raw_webhook tem source: 'webphone-widget' — nao filtra explicitamente
        // pra cobrir tambem casos onde callButton fallback p/ click2call.
      },
      orderBy: { created_at: 'desc' },
      select: { id: true, call_id: true, started_at: true, customer_id: true, direction: true, from_number: true, to_number: true, agent_extension: true },
    })

    if (!call) {
      return success({ updated: 0, reason: 'no_pending_widget_call' })
    }

    const endedAt = new Date()
    const calculatedDur = Math.max(0, Math.floor((endedAt.getTime() - call.started_at.getTime()) / 1000))
    const duration = body.duration_sec ?? calculatedDur
    // Se duracao < 3s, provavelmente nao foi atendida (ring sem ack)
    const inferredStatus = duration < 3 ? 'no_answer' : 'completed'
    const finalStatus = body.status || inferredStatus

    const updated = await prisma.voipCall.update({
      where: { id: call.id },
      data: {
        status: finalStatus,
        ended_at: endedAt,
        duration_sec: duration,
        answered_at: finalStatus === 'completed' || finalStatus === 'answered' ? call.started_at : null,
        updated_at: endedAt,
      },
      select: { id: true, call_id: true, status: true, duration_sec: true },
    })

    // SSE pro CRM Pop atualizar
    emitVoipEvent({
      type: finalStatus === 'completed' || finalStatus === 'answered' ? 'call.answered' : 'call.missed',
      companyId: user.companyId,
      voipCallId: call.id,
      callId: call.call_id,
      direction: (call.direction as 'inbound' | 'outbound') || 'outbound',
      fromNumber: call.from_number,
      toNumber: call.to_number,
      customerId: call.customer_id,
      customerName: null,
      agentExtension: call.agent_extension,
      status: finalStatus,
      startedAt: call.started_at.toISOString(),
    })

    return success({
      updated: 1,
      voipCallId: updated.id,
      callId: updated.call_id,
      status: updated.status,
      duration_sec: updated.duration_sec,
    })
  } catch (e) {
    return handleError(e)
  }
}
