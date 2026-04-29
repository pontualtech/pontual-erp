import { NextRequest } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth'
import { prisma } from '@pontual/db'
import { error, handleError, success } from '@/lib/api-response'
import { sonaxClick2Call } from '@/lib/voip/click2call'
import { getExtensionByEmail } from '@/lib/voip/extensionMap'
import { normalizePhone, getPhoneSearchVariants } from '@/lib/voip/phone'
import { emitVoipEvent } from '@/lib/voip/eventBus'

/**
 * POST /api/voip/click-to-call
 *
 * Body:
 *   {
 *     "phoneNumber": "12997361519",       // obrigatório, 8-13 dígitos
 *     "customerId": "uuid-do-cliente",    // opcional (para CDR/audit futuro)
 *     "serviceOrderId": "uuid-da-OS"      // opcional (para CDR/audit futuro)
 *   }
 *
 * Comportamento:
 *   1. requireAuth() — só usuário logado pode disparar
 *   2. resolve ramal SIP do agente via SONAX_RAMAL_MAPPING (email -> ramal)
 *   3. dispara Click2Call Sonax (Linphone do agente toca primeiro)
 *
 * Resposta sucesso:
 *   { ok: true, data: { ramal, destinationNumber, sonaxResponse, customerId?, serviceOrderId? } }
 *
 * Resposta erro:
 *   400 — body inválido / sem ramal cadastrado / número inválido
 *   401 — não autenticado (requireAuth)
 *   502 — Sonax retornou erro
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
      return error(
        'Você não tem ramal SIP cadastrado. Peça ao administrador pra te incluir no mapping de telefonia.',
        400
      )
    }

    const json = await req.json().catch(() => null)
    if (!json) {
      return error('Body JSON inválido', 400)
    }

    const body = Body.parse(json)

    const result = await sonaxClick2Call({
      numero: body.phoneNumber,
      ramal,
    })

    if (!result.ok) {
      return error(result.error || 'Falha ao iniciar chamada', 502)
    }

    // Cria VoipCall outbound imediatamente — webhook das filas Sonax NÃO cobre
    // outbound (só roteia inbound), então sem isso a ligação fica invisível
    // no /voip/calls. Status inicial "ringing" — atendente pode editar
    // manualmente depois ou um cron sync-cdr completa via API Sonax.
    let voipCall: { id: string; call_id: string; customer_id: string | null } | null = null
    try {
      const toNumber = normalizePhone(body.phoneNumber)
      const startedAt = new Date()
      const callId = `c2c-${user.id.slice(0, 8)}-${Date.now()}`

      // Lookup customer se não veio explicito
      let customerId = body.customerId || null
      let customerName: string | null = null
      if (!customerId && toNumber.length >= 8) {
        const variants = getPhoneSearchVariants(toNumber)
        const customer = await prisma.customer.findFirst({
          where: {
            company_id: user.companyId,
            deleted_at: null,
            OR: [
              { phone: { in: variants } },
              { mobile: { in: variants } },
            ],
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

      voipCall = await prisma.voipCall.create({
        data: {
          company_id: user.companyId,
          call_id: callId,
          direction: 'outbound',
          from_number: ramal,
          to_number: toNumber,
          customer_id: customerId,
          agent_user_id: user.id,
          agent_extension: ramal,
          started_at: startedAt,
          status: 'ringing',
          service_order_id: body.serviceOrderId || null,
          raw_webhook: { source: 'click2call', user: user.email },
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
    } catch (e) {
      // Não falhar Click2Call só porque registro CDR quebrou — log e segue
      console.error('[click-to-call] falha ao criar VoipCall:', e)
    }

    return success({
      ramal,
      destinationNumber: body.phoneNumber.replace(/\D/g, ''),
      sonaxResponse: result.data,
      customerId: body.customerId,
      serviceOrderId: body.serviceOrderId,
      voipCallId: voipCall?.id ?? null,
      message: `Linphone do ramal ${ramal} vai tocar — atende para falar com o cliente.`,
    })
  } catch (e) {
    return handleError(e)
  }
}
