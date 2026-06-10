/**
 * GET /api/voip/webphone-token
 *
 * Retorna o token do widget Sonax Webphone do user logado, baseado no
 * mapeamento email -> ramal e ramal -> token.
 *
 * Resposta:
 *   { ramal, token, dataClient } — pra montar a URL do script
 *   ou { ramal: null } com HTTP 200 se user não tem ramal/token (estado vazio
 *   válido — não é erro. Antes retornava 404, que o browser logava como
 *   console-error em todo load do dashboard pra quem não usa Sonax. Eco audit 10/06.)
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
      // Estado vazio válido (não erro): user sem ramal → sem webphone.
      return success({ ramal: null, token: null, dataClient: null })
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
      // Ramal existe mas sem token Sonax configurado — estado vazio, não erro.
      return success({ ramal, token: null, dataClient: null })
    }
    const dataClient = process.env.SONAX_WEBPHONE_CLIENT_ID || ''
    return success({ ramal, token, dataClient })
  } catch (e) {
    return handleError(e)
  }
}
