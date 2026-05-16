/**
 * Endpoint público pra forms de contato dos sites estáticos.
 *
 * POST /api/public/contact-form
 *
 * Substitui o formsubmit.co (terceiro com outage 15/05/2026). Body identifica
 * o site via campo `site` (mapping hardcoded), valida com Zod, e dispara email
 * via Resend pro destinatário configurado em Settings do tenant.
 *
 * Anti-spam:
 * - Honeypot `_gotcha` (mesma convenção formsubmit.co — facilita migração HTML).
 * - Rate limit 5 envios/IP/15min via memória in-process.
 *
 * CORS: aceita Origin dos 6 sites PT + IMP.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface SiteConfig {
  companyId: string
  toEmail: string         // Onde o lead chega
  siteName: string
}

const SITE_MAP: Record<string, SiteConfig> = {
  sos:    { companyId: 'pontualtech-001',                      toEmail: 'contato@pontualtech.com.br', siteName: 'SOS Impressora' },
  doutor: { companyId: 'pontualtech-001',                      toEmail: 'contato@pontualtech.com.br', siteName: 'Doutor Impressora' },
  rc:     { companyId: 'pontualtech-001',                      toEmail: 'contato@pontualtech.com.br', siteName: 'RC Impressoras' },
  pt:     { companyId: 'pontualtech-001',                      toEmail: 'contato@pontualtech.com.br', siteName: 'PontualTech' },
  ptnet:  { companyId: 'pontualtech-001',                      toEmail: 'contato@pontualtech.com.br', siteName: 'PontualTech.net' },
  imp:    { companyId: '86c829cf-32ed-4e40-80cd-59ce4178aa1a', toEmail: 'contato@imprimitech.com.br', siteName: 'Imprimitech' },
}

const ALLOWED_ORIGINS = [
  'https://sosimpressora.com',
  'https://www.sosimpressora.com',
  'https://doutorimpressora.com',
  'https://www.doutorimpressora.com',
  'https://rcimpressoras.com',
  'https://www.rcimpressoras.com',
  'https://pontualtech.com.br',
  'https://www.pontualtech.com.br',
  'https://pontualtech.net',
  'https://www.pontualtech.net',
  'https://imprimitech.com.br',
  'https://www.imprimitech.com.br',
]

const contactSchema = z.object({
  site: z.enum(['sos', 'doutor', 'rc', 'pt', 'ptnet', 'imp']),
  name: z.string().min(2).max(120).trim(),
  email: z.string().email().max(160).trim(),
  phone: z.string().min(8).max(30).trim(),
  marca: z.string().max(160).optional(),
  tipo: z.string().max(60).optional(),
  mensagem: z.string().min(1).max(2000),
  _gotcha: z.string().max(0).optional(), // honeypot — vazio = humano
}).strict()

// Rate limit in-memory (process-local; pra multi-pod usar Redis)
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const RATE_LIMIT_MAX = 5
const ipBucket = new Map<string, { count: number; reset: number }>()

function checkRate(ip: string): boolean {
  const now = Date.now()
  const b = ipBucket.get(ip)
  if (!b || b.reset < now) {
    ipBucket.set(ip, { count: 1, reset: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (b.count >= RATE_LIMIT_MAX) return false
  b.count++
  return true
}

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'

  if (!checkRate(ip)) {
    return NextResponse.json({ error: 'Muitas requisições. Tente em 15min.' }, { status: 429, headers: cors })
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400, headers: cors })
  }

  const parse = contactSchema.safeParse(payload)
  if (!parse.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parse.error.errors.slice(0, 3) }, { status: 400, headers: cors })
  }
  const data = parse.data

  // Honeypot — silent success (não revela que detectou bot)
  if (data._gotcha && data._gotcha.length > 0) {
    return NextResponse.json({ ok: true, message: 'Recebido!' }, { status: 200, headers: cors })
  }

  const site = SITE_MAP[data.site]

  // Carrega from email do tenant
  const settings = await prisma.setting.findMany({
    where: { company_id: site.companyId, key: { startsWith: 'email.' } },
  })
  const get = (k: string) => settings.find(s => s.key === k)?.value || ''
  const apiKey = get('email.resend_api_key') || process.env.RESEND_API_KEY || ''
  const fromName = get('email.from_name') || site.siteName
  const fromAddress = get('email.from_address') || ''

  if (!apiKey || !fromAddress) {
    console.error('[contact-form] Email config missing for', data.site, site.companyId)
    return NextResponse.json({ error: 'Configuração de email pendente. Use WhatsApp.' }, { status: 500, headers: cors })
  }

  const subject = `[${site.siteName}] Novo contato — ${data.name}`
  const html = `
<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:24px auto;padding:24px;color:#0f172a">
  <h2 style="color:#7c3aed;margin-top:0">Novo contato pelo site ${site.siteName}</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:8px 0;color:#64748b;width:130px">Nome</td><td><strong>${escapeHtml(data.name)}</strong></td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Email</td><td><a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Telefone/WhatsApp</td><td><a href="https://wa.me/55${data.phone.replace(/\D/g, '')}">${escapeHtml(data.phone)}</a></td></tr>
    ${data.marca ? `<tr><td style="padding:8px 0;color:#64748b">Marca/Modelo</td><td>${escapeHtml(data.marca)}</td></tr>` : ''}
    ${data.tipo ? `<tr><td style="padding:8px 0;color:#64748b">Tipo de serviço</td><td>${escapeHtml(data.tipo)}</td></tr>` : ''}
  </table>
  <h3 style="margin-top:24px;color:#0f172a">Mensagem:</h3>
  <p style="background:#f9fafb;padding:16px;border-radius:8px;white-space:pre-wrap">${escapeHtml(data.mensagem)}</p>
  <p style="margin-top:24px;font-size:12px;color:#94a3b8">
    Origem: ${origin || 'desconhecida'} · IP: ${ip}
  </p>
</body></html>
`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${fromName} <${fromAddress}>`,
        to: [site.toEmail],
        reply_to: data.email,
        subject,
        html,
        tags: [
          { name: 'campaign', value: `contact_form_${data.site}` },
          { name: 'company', value: site.companyId },
        ],
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.id) {
      console.error('[contact-form] Resend failed', res.status, body)
      return NextResponse.json({ error: 'Falha ao enviar. Tente WhatsApp.' }, { status: 502, headers: cors })
    }
    return NextResponse.json({ ok: true, message: 'Recebido! Entraremos em contato em breve.' }, { status: 200, headers: cors })
  } catch (e: any) {
    console.error('[contact-form] Network err', e?.message)
    return NextResponse.json({ error: 'Erro de rede. Tente WhatsApp.' }, { status: 502, headers: cors })
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
