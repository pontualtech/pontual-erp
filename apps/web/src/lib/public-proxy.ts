import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

/**
 * Eco audit security-fix (2026-05-30): proxy server-side pra requests
 * do site público pontualtech.com.br pro ERP interno.
 *
 * Resolve: BOT_ANA_API_KEY estava embedded no HTML público (c9722d70...),
 * permitindo qualquer atacante autenticar como bot no ERP por ~30 dias.
 *
 * Padrão: site público chama `/api/public/site/*` (sem key), proxy
 * valida Origin + rate-limit, depois invoca `/api/bot/*` internamente
 * com X-Bot-Key servidor-só (process.env.BOT_ANA_API_KEY).
 */

// Origins permitidas pro proxy site público. Adicionar domínios extras
// (ex: www, staging) se hospedar em mais lugares.
const ALLOWED_ORIGINS = [
  'https://pontualtech.com.br',
  'https://www.pontualtech.com.br',
  // Permitir testes locais em dev — verificar process.env.NODE_ENV
]

export interface ProxyGateResult {
  allowed: boolean
  reason?: string
  status?: number
  ip: string
}

/**
 * Validate origin + rate limit. Returns gate result.
 * @param req Next request
 * @param rlMax requests por minuto permitidos (default 10)
 */
export function gateRequest(req: NextRequest, rlMax: number = 10): ProxyGateResult {
  const ip = getClientIp(req as unknown as Request)

  // Origin check — aceita Origin OU Referer (header browser-controlled).
  // Não 100% à prova (attacker pode forjar via curl), mas barra automação
  // casual de bot. Combinado com rate-limit, dá mitigation razoável.
  const origin = req.headers.get('origin') || ''
  const referer = req.headers.get('referer') || ''
  const source = origin || referer

  // Em dev local (NODE_ENV !== production), permite qualquer origin pra testes.
  const isDev = process.env.NODE_ENV !== 'production'
  const matchesAllowed = ALLOWED_ORIGINS.some(o => source.startsWith(o))

  if (!isDev && !matchesAllowed) {
    return {
      allowed: false,
      reason: `origin_not_allowed: ${source.slice(0, 100) || 'empty'}`,
      status: 403,
      ip,
    }
  }

  // Rate limit por IP (sliding window in-memory, single-pod Coolify safe)
  const rl = rateLimit(`public-proxy:${ip}`, rlMax, 60_000)
  if (!rl.allowed) {
    return {
      allowed: false,
      reason: 'rate_limit',
      status: 429,
      ip,
    }
  }

  return { allowed: true, ip }
}

/**
 * Repassa request pro endpoint interno /api/bot/* com X-Bot-Key servidor-só.
 * @param req request original
 * @param internalPath path interno do ERP (ex: '/api/bot/abrir-os')
 * @param init optional fetch options override
 */
export async function forwardToBot(
  req: NextRequest,
  internalPath: string,
  init?: RequestInit,
): Promise<Response> {
  const key = process.env.BOT_ANA_API_KEY
  if (!key) {
    return NextResponse.json({ ok: false, erro: 'BOT_ANA_API_KEY não configurada' }, { status: 503 })
  }

  // Build URL preservando query string da request original
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const target = new URL(internalPath, baseUrl)
  // Copia query params
  req.nextUrl.searchParams.forEach((v, k) => target.searchParams.set(k, v))

  // Headers: preserva content-type, adiciona X-Bot-Key.
  // NÃO repassa Origin/Referer pro ERP interno (são pro proxy, não bot).
  const fwdHeaders: Record<string, string> = {
    'X-Bot-Key': key,
  }
  const contentType = req.headers.get('content-type')
  if (contentType) fwdHeaders['content-type'] = contentType

  const method = init?.method || req.method

  // Body forwarding — só pra POST/PUT/PATCH
  let body: BodyInit | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    if (init?.body !== undefined && init.body !== null) {
      body = init.body
    } else {
      // Stream body original — Node fetch precisa de Buffer/string
      const buf = await req.arrayBuffer()
      body = buf
    }
  }

  const upstream = await fetch(target.toString(), {
    method,
    headers: { ...fwdHeaders, ...(init?.headers as Record<string, string> | undefined) },
    body,
    // Pequeno timeout — site público não pode ficar pendurado
    signal: AbortSignal.timeout(20_000),
  })

  // Repassa response — preserva status + body, mas sanitiza headers internos
  const text = await upstream.text()
  const respHeaders: Record<string, string> = {}
  const ct = upstream.headers.get('content-type')
  if (ct) respHeaders['content-type'] = ct
  // CORS headers pra site público acessar
  respHeaders['access-control-allow-origin'] = ALLOWED_ORIGINS[0]
  respHeaders['access-control-allow-credentials'] = 'false'

  return new Response(text, { status: upstream.status, headers: respHeaders })
}

/**
 * Handler completo: gate + forward. Usar diretamente no route handler.
 */
export async function publicProxyHandler(
  req: NextRequest,
  internalPath: string,
  options?: { rlMax?: number },
): Promise<Response> {
  const gate = gateRequest(req, options?.rlMax || 10)
  if (!gate.allowed) {
    return NextResponse.json(
      { ok: false, erro: gate.reason },
      { status: gate.status || 403 }
    )
  }
  return forwardToBot(req, internalPath)
}
