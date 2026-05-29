import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@pontual/db'
import { verifyUnsubscribeToken } from '@/lib/email-unsub-token'

/**
 * Endpoint publico de descadastramento (LGPD/CAN-SPAM + RFC 8058 compliance).
 *
 * Aceita 3 formatos:
 *   1. GET  /api/public/unsubscribe?email=...[&t=<hmac>]   (RFC 8058 one-click)
 *   2. POST /api/public/unsubscribe  body: {email}          (form do site)
 *   3. POST /api/public/unsubscribe  body: List-Unsubscribe=One-Click  (RFC 8058)
 *
 * MODOS:
 *   - Token mode (recomendado): /api/public/unsubscribe?email=X&t=<hmac>
 *     hmac = HMAC-SHA256(secret, email + ts), URL gerada por sender quando envia
 *     bypass rate limit, processa direto
 *   - Best-effort mode: apenas ?email=X
 *     rate limit forte (5/min por IP+email hash) + sempre retorna ok=true
 *
 * Audit 2026-05-29 fixes:
 *  - Removido oracle: nao retorna mais `matched` no JSON
 *  - IP: prioriza x-real-ip (Coolify Traefik injeta peer real)
 *  - Rate limit: chave dupla (email-hash + IP) elimina XFF spoof
 *  - Compatibilidade com Gmail/Outlook RFC 8058 mantida (POST one-click funciona)
 */

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_PER_KEY = 5  // 5 req/min por (email+IP) — ainda flexivel pra cliques duplos
const rateMap = new Map<string, number[]>()

function getClientIp(req: NextRequest): string {
  // Coolify Traefik seta x-real-ip com o IP real do client (post-Cloudflare)
  // Confiar nele em vez do XFF que e trivially spoofable
  return (req.headers.get('x-real-ip') || '').trim()
    || (req.headers.get('x-forwarded-for') || '').split(',').pop()?.trim() // ultimo IP, nao primeiro (anti-spoof)
    || ''
}

function hashKey(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('base64url').slice(0, 16)
}

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const stamps = (rateMap.get(key) || []).filter(t => t > windowStart)
  if (stamps.length >= RATE_LIMIT_MAX_PER_KEY) return false
  stamps.push(now)
  rateMap.set(key, stamps)
  if (rateMap.size > 5000 && Math.random() < 0.01) {
    for (const [k, v] of rateMap) {
      if (v.length === 0 || v[v.length - 1] < windowStart) rateMap.delete(k)
    }
  }
  return true
}

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
}

async function markUnsubscribed(email: string): Promise<void> {
  await prisma.marketingContact.updateMany({
    where: { email, unsubscribed: false },
    data: { unsubscribed: true, unsubscribed_at: new Date() },
  })
}

function htmlResponse(message: string, ok: boolean): NextResponse {
  const color = ok ? '#10b981' : '#ef4444'
  const icon = ok ? '✓' : '!'
  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? 'Descadastrado' : 'Erro'} | PontualTech</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f9fafb;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;max-width:480px;padding:48px 40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);text-align:center}
  .icon{width:64px;height:64px;border-radius:50%;background:${color};color:#fff;font-size:32px;font-weight:bold;display:inline-flex;align-items:center;justify-content:center;margin-bottom:24px}
  h1{font-size:22px;margin:0 0 12px;color:#111}
  p{color:#555;line-height:1.5;margin:0 0 24px}
  a{color:#0b5fba;text-decoration:none;font-weight:600}
</style></head>
<body><div class="card">
<div class="icon">${icon}</div>
<h1>${message}</h1>
<p>Voltar pra <a href="https://pontualtech.com.br/">pontualtech.com.br</a></p>
</div></body></html>`
  return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

async function handle(req: NextRequest, email: string | null, token: string | null, wantsHtml: boolean) {
  if (!email) {
    return wantsHtml
      ? htmlResponse('E-mail não informado', false)
      : NextResponse.json({ ok: false, error: 'email required' }, { status: 400 })
  }

  // Token mode: bypass rate limit (URL veio do sender, confiavel)
  const trustedToken = token && verifyUnsubscribeToken(token, email)

  if (!trustedToken) {
    // Rate limit dupla: chave = (email-hash, IP-hash) — XFF spoof so esvazia bucket do proprio IP
    const ip = getClientIp(req)
    const key = hashKey(email, ip || 'no-ip')
    if (!checkRateLimit(key)) {
      // Sem oracle: mesma resposta de sucesso, so atrasa o efeito real (nao marca DB)
      return wantsHtml
        ? htmlResponse('Tudo certo! Você não receberá mais nossos e-mails.', true)
        : NextResponse.json({ ok: true })
    }
  }

  try {
    await markUnsubscribed(email)
    return wantsHtml
      ? htmlResponse('Tudo certo! Você não receberá mais nossos e-mails.', true)
      : NextResponse.json({ ok: true }) // ANTI-ORACLE: nao revela matched count
  } catch (e) {
    console.error('[unsubscribe]', e instanceof Error ? e.message : e)
    // Mesmo em erro retorna 200 ok pra nao virar oracle de "email existe"
    return wantsHtml
      ? htmlResponse('Tudo certo! Você não receberá mais nossos e-mails.', true)
      : NextResponse.json({ ok: true })
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const email = normalizeEmail(url.searchParams.get('email'))
  const token = url.searchParams.get('t')
  const wantsHtml = (req.headers.get('accept') || '').includes('text/html')
  return handle(req, email, token, wantsHtml)
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''
  const url = new URL(req.url)
  let rawEmail: string | null = url.searchParams.get('email')
  const token = url.searchParams.get('t')

  if (!rawEmail) {
    if (contentType.includes('application/json')) {
      try {
        const body = await req.json()
        rawEmail = body.email || null
      } catch {}
    } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      try {
        const form = await req.formData()
        rawEmail = (form.get('email') as string) || null
      } catch {}
    }
  }

  const email = normalizeEmail(rawEmail)
  const wantsHtml = (req.headers.get('accept') || '').includes('text/html')
  return handle(req, email, token, wantsHtml)
}
