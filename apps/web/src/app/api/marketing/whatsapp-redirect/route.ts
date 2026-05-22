import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import crypto from 'node:crypto'

/**
 * CWT server-side fingerprint endpoint (público, sem auth, CORS aberto).
 *
 * Chamado pela tag GTM "PT WhatsApp CWT" ANTES de redirecionar pro wa.me.
 * Grava snapshot {gclid, utm_*, phone_destination, click_at} pra que o bot
 * Marta/Ana/Aline/Grazi possa cruzar com mensagens incoming sem [ref:...]
 * (caso o cliente apague o texto pré-preenchido).
 *
 * Idempotência: cada click gera 1 row. TTL: 30 min via expires_at.
 *
 * Sem auth porque é chamado direto do navegador do cliente.
 * Rate limit: nginx/edge (deploy responsibility). Aqui validamos só shape.
 */

const ALLOWED_ORIGINS = [
  'https://pontualtech.com.br',
  'https://www.pontualtech.com.br',
  'https://sosimpressora.com',
  'https://www.sosimpressora.com',
  'https://rcimpressoras.com',
  'https://www.rcimpressoras.com',
  'https://pontualtech.net',
  'https://www.pontualtech.net',
  'https://imprimitech.com.br',
  'https://www.imprimitech.com.br',
  'https://doutorimpressora.com',
  'https://www.doutorimpressora.com',
]

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
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
  const salt = process.env.WHATSAPP_REDIRECT_SALT || 'pt-default-salt-CHANGE-ME'
  return crypto.createHash('sha256').update(`${ip}:${salt}`).digest('hex').slice(0, 32)
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || req.headers.get('x-real-ip')
      || ''
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)

  try {
    const body = await req.json().catch(() => ({}))

    const phoneDestination = digitsOnly(body.phone_destination || body.phone || '')
    if (!phoneDestination || phoneDestination.length < 10) {
      return NextResponse.json({ error: 'phone_destination required' }, { status: 400, headers })
    }

    const ip = getClientIp(req)
    const ipHash = ip ? hashIp(ip) : null

    await prisma.marketingWhatsappRedirect.create({
      data: {
        phone_destination: phoneDestination,
        gclid:        body.gclid || null,
        msclkid:      body.msclkid || null,
        gbraid:       body.gbraid || null,
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
