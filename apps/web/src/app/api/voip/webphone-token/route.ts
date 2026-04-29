/**
 * GET /api/voip/webphone-token
 *
 * Retorna o token do widget Sonax Webphone do user logado, baseado no
 * mapeamento email -> ramal e ramal -> token.
 *
 * Resposta:
 *   { ramal, token, dataClient } — pra montar a URL do script
 *   ou 404 se user não tem ramal mapeado / ramal sem token
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { error, handleError, success } from '@/lib/api-response'
import { getExtensionByEmail } from '@/lib/voip/extensionMap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth()
    const ramal = getExtensionByEmail(user.email)
    if (!ramal) {
      return error('User sem ramal SIP mapeado', 404)
    }
    const tokensRaw = process.env.SONAX_WEBPHONE_TOKENS
    if (!tokensRaw) {
      return error('SONAX_WEBPHONE_TOKENS env não configurado', 500)
    }
    let tokens: Record<string, string>
    try {
      tokens = JSON.parse(tokensRaw)
    } catch {
      return error('SONAX_WEBPHONE_TOKENS env malformado', 500)
    }
    const token = tokens[ramal]
    if (!token) {
      return error(`Sem token Sonax pro ramal ${ramal}`, 404)
    }
    const dataClient = process.env.SONAX_WEBPHONE_CLIENT_ID || ''
    return success({ ramal, token, dataClient })
  } catch (e) {
    return handleError(e)
  }
}
