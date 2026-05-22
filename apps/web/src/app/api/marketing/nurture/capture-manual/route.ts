import { NextRequest } from 'next/server'
import { z } from 'zod'
import { success, handleError, error as apiError } from '@/lib/api-response'
import { getServerUser } from '@/lib/auth'
import { createOrUpdateJourney } from '@/lib/nurture/journey'

// Next 14: depende de cookies da sessão — força runtime
export const dynamic = 'force-dynamic'

/**
 * POST /api/marketing/nurture/capture-manual
 *
 * Captura manual de lead pelo atendente (UI Chatwoot/portal).
 * Mesma lógica do /api/internal/nurture/capture mas auth via sessão user
 * normal (não internal-key) — pra UI/atendente em vez de bot Dify.
 *
 * Body:
 *   {
 *     "email": "cliente@example.com",
 *     "phone": "+5511...",
 *     "name": "João",
 *     "journey_type": "recused_os",  // opcional, default
 *     "source_data": {                // opcional
 *       "conversation_id": 12345,
 *       "refused_quote_id": "...",
 *       "equipments_interest": ["printer", "notebook"],
 *       "notes": "Falou que vai pensar"
 *     }
 *   }
 *
 * Returns: { journey_id, contact_id, is_new }
 */
const Body = z.object({
  email: z.string().email(),
  phone: z.string().optional(),
  name: z.string().optional(),
  journey_type: z.string().optional(),
  source_data: z.record(z.unknown()).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser()
    if (!user) return apiError('Não autenticado', 401)
    if (!user.companyId) return apiError('Company não definida', 400)

    const body = Body.parse(await req.json())
    const result = await createOrUpdateJourney({
      ...body,
      company_id: user.companyId,
      source_data: {
        ...body.source_data,
        captured_by_user_id: user.id,
        captured_via: 'manual_ui',
      },
    })
    return success(result)
  } catch (err) {
    return handleError(err, {
      url: '/api/marketing/nurture/capture-manual',
      method: 'POST',
    })
  }
}
