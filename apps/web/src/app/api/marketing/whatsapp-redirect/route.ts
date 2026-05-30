import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import crypto from 'node:crypto'

/**
 * CWT server-side fingerprint endpoint (público, sem auth, CORS aberto).
 *
 * Chamado pela tag GTM "PT WhatsApp CWT" ANTES de redirecionar pro wa.me.
 * Grava snapshot {gclid, utm_*, phone_destination, click_at} pra que o bot
 * Marta/Ana/Aline/Grazi possa cruzar com mensagens incoming sem [ref:...].
 *
 * Idempotência: cada click gera 1 row. TTL: 24 h via expires_at (era 30 min até 2026-05-29).
 *
 * Sem auth porque é chamado direto do navegador do cliente.
 *
 * Audit 2026-05-24:
 *  - Rate limit in-memory por IP hash (60 POSTs/min) → anti-flood
 *  - Body size limit (4 KB) → anti-DB-bloat
 *  - company_id derivado de Origin header → match strict no bot evita cross-tenant
 */

// hostname → company_id (allowlist + tenant resolver). Adicione sites novos aqui.
// PT: pontualtech-001 / IMP: 86c829cf-32ed-4e40-80cd-59ce4178aa1a
const HOSTNAME_TO_COMPANY: Record<string, string> = {
  'pontualtech.com.br':     'pontualtech-001',
  'www.pontualtech.com.br': 'pontualtech-001',
  'sosimpressora.com':      'pontualtech-001',
  'www.sosimpressora.com':  'pontualtech-001',
  'rcimpressoras.com':      'pontualtech-001',
  'www.rcimpressoras.com':  'pontualtech-001',
  'pontualtech.net':        'pontualtech-001',
  'www.pontualtech.net':    'pontualtech-001',
  'doutorimpressora.com':   'pontualtech-001',
  'www.doutorimpressora.com': 'pontualtech-001',
  'imprimitech.com.br':     '86c829cf-32ed-4e40-80cd-59ce4178aa1a',
  'www.imprimitech.com.br': '86c829cf-32ed-4e40-80cd-59ce4178aa1a',
}

const ALLOWED_ORIGINS = Object.keys(HOSTNAME_TO_COMPANY).map(h => `https://${h}`)
const MAX_BODY_BYTES = 4096
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60

// In-memory rate limit (per-pod). Aceita janela de pico, anti-spam grosseiro.
// Em multi-pod, cada pod tem janela própria — ok pra MVP, suficiente p/ deter floods triviais.
const rateMap = new Map<string, number[]>()

function corsHeaders(origin: string | null): Record<string, string> {
  // Só ecoa Allow-Origin se origin está na allowlist (caso contrário browser bloqueia naturalmente).
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

function digitsOnly(s: string): string {
  return (s || '').replace(/\D+/g, '')
}

function hashIp(ip: string): string {
  // Auditoria 24/05: salt fixo 'pt-default-salt-CHANGE-ME' removido (CWT
  // fingerprint era previsível sem env). Fail-closed em prod.
  const salt = process.env.WHATSAPP_REDIRECT_SALT
  if (!salt) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('WHATSAPP_REDIRECT_SALT obrigatório em produção')
    }
    return crypto.createHash('sha256').update(`${ip}:dev-salt-local-only`).digest('hex').slice(0, 32)
  }
  return crypto.createHash('sha256').update(`${ip}:${salt}`).digest('hex').slice(0, 32)
}

function getClientIp(req: NextRequest): string {
  // 2026-05-30 audit #2 fix: x-real-ip (Coolify Traefik injeta peer real) >
  // XFF.pop() (último IP do chain, mais próximo do servidor — anti-spoof).
  // Antes pegava XFF[0] que era trivially spoofable (cliente seta
  // x-forwarded-for=7.7.7.7 → bucket diferente → bypass rate limit).
  return (req.headers.get('x-real-ip') || '').trim()
      || (req.headers.get('x-forwarded-for') || '').split(',').pop()?.trim()
      || ''
}

function originToCompanyId(origin: string | null): string | null {
  if (!origin) return null
  try {
    const u = new URL(origin)
    return HOSTNAME_TO_COMPANY[u.hostname.toLowerCase()] ?? null
  } catch {
    return null
  }
}

function checkRateLimit(ipKey: string): boolean {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const stamps = (rateMap.get(ipKey) || []).filter(t => t > windowStart)
  if (stamps.length >= RATE_LIMIT_MAX) return false
  stamps.push(now)
  rateMap.set(ipKey, stamps)
  // Garbage collect: limpa entradas vazias ocasionalmente
  if (rateMap.size > 1000 && Math.random() < 0.01) {
    for (const [k, v] of rateMap) {
      if (v.length === 0 || v[v.length - 1] < windowStart) rateMap.delete(k)
    }
  }
  return true
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)

  // 2026-05-30 audit #2 fix: rejeitar origens cross-origin server-side.
  // Antes: CORS headers só afetavam browser; ataque direto-em-API (curl)
  // passava e gravava row poisoning a tabela marketing_whatsapp_redirects
  // (DB bloat + gclid forjado poluindo Quality Score Google Ads).
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return NextResponse.json({ error: 'origem nao autorizada' }, { status: 403, headers })
  }

  try {
    // Body size guard ANTES de parse — evita JSON gigante consumir CPU/RAM
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload too large' }, { status: 413, headers })
    }

    const body = raw ? JSON.parse(raw) : {}

    const phoneDestination = digitsOnly(body.phone_destination || body.phone || '')
    if (!phoneDestination || phoneDestination.length < 10) {
      return NextResponse.json({ error: 'phone_destination required' }, { status: 400, headers })
    }

    const ip = getClientIp(req)
    const ipHash = ip ? hashIp(ip) : null

    // Rate limit por IP hash (anti-flood)
    const rlKey = ipHash || 'no-ip'
    if (!checkRateLimit(rlKey)) {
      return NextResponse.json({ error: 'rate limit' }, { status: 429, headers })
    }

    const companyId = originToCompanyId(origin)

    await prisma.marketingWhatsappRedirect.create({
      data: {
        company_id: companyId,
        phone_destination: phoneDestination,
        gclid:        body.gclid || null,
        msclkid:      body.msclkid || null,
        gbraid:       body.gbraid || null,
        fbclid:       body.fbclid || null,
        li_fat_id:    body.li_fat_id || null,
        twclid:       body.twclid || null,
        ttclid:       body.ttclid || null,
        utm_source:   body.utm_source || body.src || null,
        utm_medium:   body.utm_medium || body.med || null,
        utm_campaign: body.utm_campaign || body.camp || null,
        utm_term:     body.utm_term || body.kw || null,
        utm_content:  body.utm_content || null,
        page_url:     body.page_url || null,
        referrer:     body.referrer || null,
        ip_hash:      ipHash,
        user_agent:   req.headers.get('user-agent')?.slice(0, 500) || null,
        button_position: body.button_position || null,
        raw_payload:  body,
      },
    })

    return NextResponse.json({ ok: true }, { headers })
  } catch (e) {
    // Não falha o redirect do cliente — log e retorna 200 (mesmo se grava falhou)
    console.error('[whatsapp-redirect] error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false }, { headers, status: 200 })
  }
}
