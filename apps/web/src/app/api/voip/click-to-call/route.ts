import { NextRequest } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth'
import { error, handleError, success } from '@/lib/api-response'
import { sonaxClick2Call } from '@/lib/voip/click2call'
import { getExtensionByEmail } from '@/lib/voip/extensionMap'

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

    return success({
      ramal,
      destinationNumber: body.phoneNumber.replace(/\D/g, ''),
      sonaxResponse: result.data,
      customerId: body.customerId,
      serviceOrderId: body.serviceOrderId,
      message: `Linphone do ramal ${ramal} vai tocar — atende para falar com o cliente.`,
    })
  } catch (e) {
    return handleError(e)
  }
}
