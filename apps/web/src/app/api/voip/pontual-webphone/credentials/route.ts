/**
 * GET /api/voip/pontual-webphone/credentials
 *
 * Retorna credenciais SIP pra o ramal do user logado (PontualPABX).
 * Substitui /api/voip/webphone-token (que era do Sonax).
 *
 * Resposta:
 *   {
 *     wsUrl: 'wss://pabx.pontualtech.work/ws',
 *     ramal: '102',
 *     password: '...',
 *     domain: 'pabx.pontualtech.work',
 *     displayName: 'Daniela'
 *   }
 *
 * 404 se user nao tem ramal cadastrado.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requireAuth } from '@/lib/auth'
import { error, handleError, success } from '@/lib/api-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth()

    // Busca o ramal atribuido a esse user
    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT e.number, e.secret_plain, e.description, e.webrtc, e.is_active
       FROM voip_extensions e
       WHERE e.company_id = $1 AND e.user_id = $2 AND e.is_active = true
       LIMIT 1`,
      user.companyId, user.id,
    )

    if (rows.length === 0) {
      return error('Voce nao tem ramal SIP atribuido. Peca pro admin cadastrar.', 404)
    }

    const ext = rows[0]
    if (!ext.webrtc) {
      return error('Seu ramal e SIP fisico (nao WebRTC). Use Linphone Desktop.', 400)
    }

    const wsUrl = process.env.PONTUAL_PABX_WS_URL || 'wss://pabx.pontualtech.work/ws'
    const domain = process.env.PONTUAL_PABX_DOMAIN || 'pabx.pontualtech.work'

    return success({
      wsUrl,
      domain,
      ramal: ext.number,
      password: ext.secret_plain,
      displayName: user.name,
    })
  } catch (e) {
    return handleError(e)
  }
}
