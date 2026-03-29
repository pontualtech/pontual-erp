/**
 * Autenticação via API Key para rotas /api/v1/
 *
 * Valida X-API-Key + X-API-Secret nos headers
 * Verifica permissões e rate limiting
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createHmac, timingSafeEqual } from 'crypto'
import { rateLimit } from '@/lib/rate-limit'

export interface ApiKeyUser {
  apiKeyId: string
  companyId: string
  name: string
  permissions: string[]
  rateLimit: number
  rateLimitRemaining: number
}

/**
 * Valida API key e retorna dados do usuário da API
 */
export async function authenticateApiKey(
  req: NextRequest
): Promise<ApiKeyUser | NextResponse> {
  const apiKey = req.headers.get('x-api-key')
  const apiSecret = req.headers.get('x-api-secret')

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'API key e secret são obrigatórios (headers X-API-Key e X-API-Secret)' },
      { status: 401 }
    )
  }

  // Validar formato da API key (alfanumérico + hífens, 16-64 chars)
  if (!/^[a-zA-Z0-9\-]{16,64}$/.test(apiKey)) {
    return NextResponse.json({ error: 'Formato de API key inválido' }, { status: 401 })
  }

  // Buscar a API key no banco
  const keyRecord = await prisma.setting.findFirst({
    where: {
      key: `api_key.${apiKey}`,
    },
  })

  if (!keyRecord) {
    return NextResponse.json(
      { error: 'API key inválida' },
      { status: 401 }
    )
  }

  // Parsear configuração da key
  let keyConfig: {
    secret_hash: string
    company_id: string
    name: string
    permissions: string[]
    rate_limit: number
    active: boolean
  }

  try {
    keyConfig = JSON.parse(keyRecord.value)
  } catch {
    return NextResponse.json(
      { error: 'Configuração de API key inválida' },
      { status: 500 }
    )
  }

  if (!keyConfig.active) {
    return NextResponse.json(
      { error: 'API key desativada' },
      { status: 403 }
    )
  }

  // Validar secret via HMAC
  const secretHash = createHmac('sha256', apiKey).update(apiSecret).digest('hex')
  try {
    const isValid = timingSafeEqual(
      Buffer.from(secretHash),
      Buffer.from(keyConfig.secret_hash)
    )
    if (!isValid) {
      return NextResponse.json({ error: 'API secret inválido' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'API secret inválido' }, { status: 401 })
  }

  // Rate limiting baseado na configuração da key
  const rl = rateLimit(
    `api-v1:${apiKey}`,
    keyConfig.rate_limit || 100,
    60 * 1000 // 1 minuto
  )

  if (!rl.success) {
    return NextResponse.json(
      { error: 'Rate limit excedido. Tente novamente em 1 minuto.' },
      { status: 429 }
    )
  }

  return {
    apiKeyId: apiKey,
    companyId: keyConfig.company_id,
    name: keyConfig.name,
    permissions: keyConfig.permissions || [],
    rateLimit: keyConfig.rate_limit || 100,
    rateLimitRemaining: rl.remaining,
  }
}

/**
 * Cria NextResponse com headers de rate limit
 */
export function apiResponse(data: any, user: ApiKeyUser, status = 200): NextResponse {
  const res = NextResponse.json(data, { status })
  res.headers.set('X-RateLimit-Limit', String(user.rateLimit))
  res.headers.set('X-RateLimit-Remaining', String(user.rateLimitRemaining))
  return res
}

/**
 * Verifica se a API key tem permissão para a ação
 */
export function checkApiPermission(
  user: ApiKeyUser,
  permission: string
): NextResponse | null {
  if (!user.permissions.includes(permission) && !user.permissions.includes('*')) {
    return NextResponse.json(
      { error: `Sem permissão: ${permission}` },
      { status: 403 }
    )
  }
  return null
}
