/**
 * Envio de campanha pra um segmento salvo.
 *
 * POST /api/marketing/campanhas/send
 * Body: { segmentId, subject, html, campaignTag, dryRun? }
 *
 * Comportamento:
 * - dryRun=true → retorna { count, sample: [5 emails] } sem enviar
 * - dryRun=false → loop síncrono Resend, 100ms entre cada, tags campaign/company
 *
 * Limite: 500 envios/chamada (Next.js timeout ~60s @ 10/s).
 * Pra segmentos maiores, frontend precisa fazer batching (futuro).
 *
 * Multi-tenant: companyId do user, segmento sempre filtrado por company_id,
 * marketing_contacts idem. unsubscribed=true é excluído automaticamente.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const HARD_LIMIT = 500
const RATE_LIMIT_MS = 100 // 10/s — Resend free tier permite 100/s, fica conservador

const sendSchema = z.object({
  segmentId: z.string().uuid(),
  subject: z.string().min(1).max(200).trim(),
  html: z.string().min(1).max(50000),
  campaignTag: z.string()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'tag deve conter apenas a-z, 0-9 e _'),
  dryRun: z.boolean().optional().default(false),
}).strict()

interface ContactRow {
  id: string
  email: string
  name: string | null
}

function ensureAdmin(user: { isSuperAdmin: boolean; roleName: string }) {
  if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }
  return null
}

// Reusa filter logic do segmentos/[id]/route.ts
function buildContactsWhere(companyId: string, filters: any) {
  const where: any = { company_id: companyId, unsubscribed: false }
  const f = filters || {}
  if (f.search) {
    where.OR = [
      { email: { contains: f.search, mode: 'insensitive' } },
      { name: { contains: f.search, mode: 'insensitive' } },
      { phone: { contains: f.search } },
    ]
  }
  const tags: string[] = Array.isArray(f.tags) ? [...f.tags] : []
  if (f.segment) tags.push(`segment:${f.segment}`)
  if (f.stage) tags.push(`stage:${f.stage}`)
  if (tags.length > 0) where.tags = { hasEvery: tags }
  if (f.onlyBounced) where.bounce_count = { gt: 0 }
  return where
}

interface ResendTag { name: string; value: string }

async function sendOne(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  tags: ResendTag[],
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, tags }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok && body.id) return { ok: true, id: body.id }
    return { ok: false, error: body.message || `HTTP ${res.status}` }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network error' }
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const body = sendSchema.parse(await req.json())

    // 1. Carrega segmento (tenant-safe)
    const segment = await prisma.marketingSegment.findFirst({
      where: { id: body.segmentId, company_id: user.companyId },
    })
    if (!segment) return error('Segmento não encontrado', 404)

    // 2. Conta + amostra contatos do segmento
    const where = buildContactsWhere(user.companyId, segment.filters as any)
    const [total, sample] = await Promise.all([
      prisma.marketingContact.count({ where }),
      prisma.marketingContact.findMany({
        where,
        take: body.dryRun ? 5 : HARD_LIMIT,
        select: { id: true, email: true, name: true },
        orderBy: { id: 'asc' },
      }),
    ])

    if (total === 0) return error('Nenhum contato no segmento (após filtro unsubscribed)', 422)
    if (total > HARD_LIMIT && !body.dryRun) {
      return error(`Segmento tem ${total} contatos. Limite por envio é ${HARD_LIMIT}. Refine o filtro ou aguarde feature de batching.`, 413)
    }

    // 3. Dry-run = retorna sem enviar
    if (body.dryRun) {
      return success({
        dryRun: true,
        total,
        sample: sample.map(s => ({ email: s.email, name: s.name })),
        segmentName: segment.name,
        campaignTag: body.campaignTag,
      })
    }

    // 4. Carrega config email do tenant
    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { startsWith: 'email.' } },
    })
    const get = (k: string) => settings.find(s => s.key === k)?.value || ''
    const apiKey = get('email.resend_api_key') || process.env.RESEND_API_KEY || ''
    const fromName = get('email.from_name') || 'Marketing'
    const fromAddress = get('email.from_address') || ''

    if (!apiKey) return error('RESEND_API_KEY não configurada pro tenant nem global', 500)
    if (!fromAddress) return error('Setting email.from_address não configurada', 500)
    const from = `${fromName} <${fromAddress}>`

    // 5. Loop envio síncrono com rate limit
    const sent: { email: string; resend_id: string }[] = []
    const failed: { email: string; error: string }[] = []
    const tags: ResendTag[] = [
      { name: 'campaign', value: body.campaignTag },
      { name: 'company', value: user.companyId },
    ]
    const start = Date.now()

    for (const contact of sample as ContactRow[]) {
      const r = await sendOne(apiKey, from, contact.email, body.subject, body.html, tags)
      if (r.ok && r.id) sent.push({ email: contact.email, resend_id: r.id })
      else failed.push({ email: contact.email, error: r.error || 'unknown' })
      // Rate limit: 10/s
      if (sent.length + failed.length < sample.length) {
        await new Promise(rs => setTimeout(rs, RATE_LIMIT_MS))
      }
    }

    const durationMs = Date.now() - start

    return success({
      sent: sent.length,
      failed: failed.length,
      total: sample.length,
      durationMs,
      campaignTag: body.campaignTag,
      segmentName: segment.name,
      failedDetails: failed.slice(0, 10), // mostra primeiros 10 erros pra debug
    })
  } catch (e: any) {
    if (e?.errors && Array.isArray(e.errors)) {
      return error('Validação falhou: ' + e.errors.map((x: any) => `${x.path.join('.')} ${x.message}`).join('; '), 400)
    }
    return handleError(e)
  }
}
