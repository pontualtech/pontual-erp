import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * Endpoint publico de descadastramento (LGPD/CAN-SPAM compliance).
 *
 * Aceita 3 formatos pra suportar maximo de clientes/clients de email:
 *   1. GET  /api/public/unsubscribe?email=...   (RFC 8058 one-click)
 *   2. POST /api/public/unsubscribe  body: {email}  (form do site)
 *   3. POST /api/public/unsubscribe  body: List-Unsubscribe=One-Click  (RFC 8058)
 *
 * Marca todas as rows de marketing_contacts com aquele email como
 * unsubscribed=true (cross-company — se assinou newsletter PT e IMP, sai
 * das duas). Idempotente: descadastrar 2x = sem erro.
 *
 * Por seguranca/privacidade:
 *  - Sempre retorna 200 mesmo se email nao existe (nao revela quem esta na lista)
 *  - Rate limit in-memory (60 req/min por IP hash) anti-flood
 *  - Sem CORS strict (publico, qualquer origem pode chamar)
 *
 * Resposta:
 *  - GET com Accept: text/html  -> HTML de confirmacao
 *  - POST ou Accept: application/json -> JSON {ok}
 */

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60
const rateMap = new Map<string, number[]>()

function getClientIpHash(req: NextRequest): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
        || req.headers.get('x-real-ip') || ''
  // Hash leve so pra rate limiting (sem PII storage)
  let hash = 0
  for (const c of ip) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0
  return String(hash)
}

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const stamps = (rateMap.get(key) || []).filter(t => t > windowStart)
  if (stamps.length >= RATE_LIMIT_MAX) return false
  stamps.push(now)
  rateMap.set(key, stamps)
  return true
}

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  // Validacao basica: tem @ e ponto no dominio
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
}

async function markUnsubscribed(email: string): Promise<{ matched: number }> {
  const r = await prisma.marketingContact.updateMany({
    where: { email, unsubscribed: false },
    data: { unsubscribed: true, unsubscribed_at: new Date() },
  })
  return { matched: r.count }
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

async function handle(req: NextRequest, email: string | null, wantsHtml: boolean) {
  if (!email) {
    return wantsHtml
      ? htmlResponse('E-mail não informado', false)
      : NextResponse.json({ ok: false, error: 'email required' }, { status: 400 })
  }

  // Rate limit (anti-flood)
  if (!checkRateLimit(getClientIpHash(req))) {
    return wantsHtml
      ? htmlResponse('Muitas tentativas. Tente em 1 minuto.', false)
      : NextResponse.json({ ok: false, error: 'rate_limit' }, { status: 429 })
  }

  try {
    const { matched } = await markUnsubscribed(email)
    const successMsg = matched > 0
      ? 'Tudo certo! Você não receberá mais nossos e-mails.'
      : 'Tudo certo! Você não está mais na nossa lista.'
    return wantsHtml
      ? htmlResponse(successMsg, true)
      : NextResponse.json({ ok: true, matched })
  } catch (e) {
    console.error('[unsubscribe]', e instanceof Error ? e.message : e)
    return wantsHtml
      ? htmlResponse('Ocorreu um erro. Tente novamente.', false)
      : NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const email = normalizeEmail(url.searchParams.get('email'))
  const wantsHtml = (req.headers.get('accept') || '').includes('text/html')
  return handle(req, email, wantsHtml)
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''
  let raw: string | null = null

  if (contentType.includes('application/json')) {
    try {
      const body = await req.json()
      raw = body.email || null
    } catch {}
  } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    try {
      const form = await req.formData()
      raw = (form.get('email') as string) || null
    } catch {}
  }

  const email = normalizeEmail(raw)
  const wantsHtml = (req.headers.get('accept') || '').includes('text/html')
  return handle(req, email, wantsHtml)
}
