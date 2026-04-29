import { NextRequest } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth'
import { prisma } from '@pontual/db'
import { error, handleError, success } from '@/lib/api-response'
import { getExtensionByEmail } from '@/lib/voip/extensionMap'
import { normalizePhone, getPhoneSearchVariants } from '@/lib/voip/phone'
import { emitVoipEvent } from '@/lib/voip/eventBus'

/**
 * POST /api/voip/calls/widget-dial
 *
 * Cria registro VoipCall outbound quando agente disca pelo widget Sonax embedded
 * (SIP-WS direto). Sonax NAO dispara webhook pra outbound do widget — sem este
 * registro, a chamada fica invisivel em /voip/calls.
 *
 * CallButton deve fire-and-forget este fetch ANTES de disparar o widget.
 *
 * Body: { phoneNumber, customerId?, serviceOrderId? }
 */

const Body = z.object({
  phoneNumber: z.string().min(8).max(20),
  customerId: z.string().optional(),
  serviceOrderId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()

    const ramal = getExtensionByEmail(user.email)
    if (!ramal) {
      return error('Sem ramal SIP cadastrado pra este usuario', 400)
    }

    const json = await req.json().catch(() => null)
    if (!json) return error('Body JSON invalido', 400)
    const body = Body.parse(json)

    const toNumber = normalizePhone(body.phoneNumber)
    const startedAt = new Date()
    const callId = `widget-${user.id.slice(0, 8)}-${Date.now()}`

    let customerId = body.customerId || null
    let customerName: string | null = null
    if (!customerId && toNumber.length >= 8) {
      const variants = getPhoneSearchVariants(toNumber)
      const customer = await prisma.customer.findFirst({
        where: {
          company_id: user.companyId,
          deleted_at: null,
          OR: [{ phone: { in: variants } }, { mobile: { in: variants } }],
        },
        select: { id: true, legal_name: true, trade_name: true },
      })
      customerId = customer?.id || null
      customerName = customer?.trade_name || customer?.legal_name || null
    } else if (customerId) {
      const c = await prisma.customer.findFirst({
        where: { id: customerId, company_id: user.companyId },
        select: { legal_name: true, trade_name: true },
      })
      customerName = c?.trade_name || c?.legal_name || null
    }

    const voipCall = await prisma.voipCall.create({
      data: {
        company_id: user.companyId,
        call_id: callId,
        direction: 'outbound',
        from_number: ramal,
        to_number: toNumber,
        did_number: process.env.SONAX_DEFAULT_OUTBOUND_DID || null,
        customer_id: customerId,
        agent_user_id: user.id,
        agent_extension: ramal,
        started_at: startedAt,
        status: 'ringing',
        service_order_id: body.serviceOrderId || null,
        raw_webhook: { source: 'webphone-widget', user: user.email },
      },
      select: { id: true, call_id: true, customer_id: true },
    })

    emitVoipEvent({
      type: 'call.start',
      companyId: user.companyId,
      voipCallId: voipCall.id,
      callId: voipCall.call_id,
      direction: 'outbound',
      fromNumber: ramal,
      toNumber,
      customerId: voipCall.customer_id,
      customerName,
      agentExtension: ramal,
      status: 'ringing',
      startedAt: startedAt.toISOString(),
    })

    return success({
      voipCallId: voipCall.id,
      callId: voipCall.call_id,
      customerId: voipCall.customer_id,
    })
  } catch (e) {
    return handleError(e)
  }
}
