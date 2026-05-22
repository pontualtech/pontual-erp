import { NextRequest } from 'next/server'
import { z } from 'zod'
import { success, handleError } from '@/lib/api-response'
import { requireInternalKey } from '@/lib/internal-auth'
import { createOrUpdateJourney } from '@/lib/nurture/journey'

// Next 14: depende de headers — força runtime
export const dynamic = 'force-dynamic'

/**
 * POST /api/internal/nurture/capture
 *
 * Chamado pelo bot Dify quando cliente recusa OS e fornece email.
 * Cria/atualiza marketing_contact + cria marketing_journey ativa.
 *
 * Auth: x-internal-key
 *
 * Body:
 *   {
 *     "company_id": "pontualtech-001",
 *     "email": "cliente@example.com",
 *     "phone": "+5511...",          // opcional
 *     "name": "João da Silva",       // opcional
 *     "journey_type": "recused_os",  // opcional, default 'recused_os'
 *     "source_data": {               // opcional, contexto livre
 *       "bot_session_id": "...",
 *       "refused_quote_id": "...",
 *       "equipments_interest": ["printer", "notebook"],
 *       "original_channel": "whatsapp"
 *     }
 *   }
 *
 * Returns: { journey_id, contact_id, is_new }
 */
const Body = z.object({
  company_id: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  name: z.string().optional(),
  journey_type: z.string().optional(),
  source_data: z.record(z.unknown()).optional(),
})

export async function POST(req: NextRequest) {
  const guard = requireInternalKey(req)
  if (guard) return guard

  try {
    const body = Body.parse(await req.json())
    const result = await createOrUpdateJourney(body)
    return success(result)
  } catch (err) {
    return handleError(err, {
      url: '/api/internal/nurture/capture',
      method: 'POST',
    })
  }
}
