/**
 * Webhook Resend → marketing_contacts
 *
 * Recebe eventos do Resend (svix-signed) e atualiza marketing_contacts:
 *   - email.delivered      → não muda nada (silent ok, só loga)
 *   - email.opened         → last_opened_at = now, tag email:engaged
 *   - email.clicked        → last_clicked_at = now, tag email:engaged
 *   - email.bounced        → bounce_count++; se >=3 marca unsubscribed + tag email:bouncing
 *   - email.complained     → unsubscribed = true + tag email:complained
 *   - email.unsubscribed   → unsubscribed = true (1-click ou link do email)
 *   - email.scheduled / sent → silent ok
 *   - delivery_delayed     → silent ok
 *
 * Idempotência:
 *   - dedup por UNIQUE(provider='resend', event_id=svix-id) na marketing_webhook_event
 *   - retries do Resend (que usa Svix) ficam protegidos
 *
 * Signature:
 *   - Svix: HMAC-SHA256({svix-id}.{svix-timestamp}.{body}) com secret base64-decoded
 *   - Compara contra svix-signature header (que pode ter múltiplas assinaturas "v1,sig1 v1,sig2")
 *   - Tolerância de 5min no timestamp pra evitar replay attacks
 *
 * Env vars:
 *   - RESEND_WEBHOOK_SECRET — secret no formato "whsec_..." (base64 do secret real)
 *   - RESEND_WEBHOOK_COMPANY_ID — fallback se lookup por "from" falhar, default 'pontualtech-001'
 *
 * Multi-tenant: companyId resolvido via Setting `email.from_address` lookup
 * com base no payload.data.from. Configurar `email.from_address` em cada
 * tenant pra webhook achar o company_id correto (audit 14 fix).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TOLERANCE_SECONDS = 5 * 60

interface ResendWebhookPayload {
  type: string // 'email.delivered', 'email.opened', etc
  created_at: string
  data: {
    email_id: string
    to: string[]
    from: string
    subject?: string
    tags?: Array<{ name: string; value: string }>
    bounce?: { type?: string; subType?: string; message?: string }
    click?: { link: string; ipAddress?: string; userAgent?: string }
    complaint?: { feedbackType?: string }
  }
}

function verifySvixSignature(
  body: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string,
): { valid: boolean; reason?: string } {
  if (!svixId || !svixTimestamp || !svixSignature) return { valid: false, reason: 'missing svix headers' }

  // Tolerância anti-replay
  const ts = parseInt(svixTimestamp, 10)
  if (Number.isNaN(ts)) return { valid: false, reason: 'invalid timestamp' }
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) return { valid: false, reason: 'timestamp out of tolerance' }

  // Secret no formato whsec_BASE64 — extrair base64 puro
  const secretBase64 = secret.startsWith('whsec_') ? secret.slice(6) : secret
  let secretBuf: Buffer
  try {
    secretBuf = Buffer.from(secretBase64, 'base64')
  } catch {
    return { valid: false, reason: 'invalid secret format' }
  }
  if (secretBuf.length === 0) return { valid: false, reason: 'empty secret' }

  // Compute signature
  const signedContent = `${svixId}.${svixTimestamp}.${body}`
  const expectedSig = createHmac('sha256', secretBuf).update(signedContent).digest('base64')

  // svix-signature pode ter múltiplas: "v1,sig1 v1,sig2"
  const signatures = svixSignature.split(' ')
  for (const sigEntry of signatures) {
    const [, sigValue] = sigEntry.split(',')
    if (!sigValue) continue
    try {
      const expectedBuf = Buffer.from(expectedSig, 'utf8')
      const providedBuf = Buffer.from(sigValue, 'utf8')
      if (expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)) {
        return { valid: true }
      }
    } catch {
      continue
    }
  }
  return { valid: false, reason: 'signature mismatch' }
}

export async function POST(req: NextRequest) {
  const bodyRaw = await req.text()

  const svixId = req.headers.get('svix-id') || ''
  const svixTimestamp = req.headers.get('svix-timestamp') || ''
  const svixSignature = req.headers.get('svix-signature') || ''
  const secret = process.env.RESEND_WEBHOOK_SECRET || ''

  if (!secret) {
    console.error('[Resend webhook] RESEND_WEBHOOK_SECRET não configurado')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  // 1. Validar signature (Svix HMAC-SHA256)
  const verify = verifySvixSignature(bodyRaw, svixId, svixTimestamp, svixSignature, secret)
  if (!verify.valid) {
    console.warn('[Resend webhook] Invalid signature:', verify.reason)
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  // 2. Parse JSON
  let payload: ResendWebhookPayload
  try {
    payload = JSON.parse(bodyRaw)
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const eventType = payload.type
  const emailId = payload.data?.email_id
  const recipient = (payload.data?.to || [])[0]?.toLowerCase()
  if (!eventType || !emailId || !recipient) {
    return NextResponse.json({ error: 'invalid payload shape' }, { status: 400 })
  }

  // Audit 14 fix + hardening 14/05: resolver companyId via DOMÍNIO do "from"
  // address (não email exato). Antes patch4 (audit14) usava match exato no
  // value do Setting `email.from_address`, mas campanhas usam vários from
  // distintos por tenant (newsletter@, contato@, vendas@, sac@, etc) e só 1
  // está cadastrado no Setting. Match por domínio cobre TODOS os from de cada
  // tenant. Fallback pro env var preserva backward compat.
  let companyId = process.env.RESEND_WEBHOOK_COMPANY_ID || 'pontualtech-001'
  const fromRaw = (payload.data?.from || '').toLowerCase()
  if (fromRaw) {
    const m = fromRaw.match(/<([^>]+)>|([^\s<>]+@[^\s<>]+)/)
    const bareEmail = (m?.[1] || m?.[2] || fromRaw).trim()
    const domain = bareEmail.split('@')[1] || ''
    if (domain) {
      const fromSetting = await prisma.setting.findFirst({
        where: { key: 'email.from_address', value: { contains: `@${domain}`, mode: 'insensitive' } },
        select: { company_id: true },
      })
      if (fromSetting?.company_id) companyId = fromSetting.company_id
    }
  }

  // 3. Dedup via UNIQUE(provider, event_id) — svix-id é único por evento
  // Idempotência: se mesmo svix-id chega 2x, segundo retorna 200 sem reprocessar.
  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

  try {
    const existing = await (prisma as any).marketingWebhookEvent?.findUnique?.({
      where: { provider_event_id: { provider: 'resend', event_id: svixId } },
      select: { id: true, status: true },
    })
    if (existing && (existing.status === 'PROCESSED' || existing.status === 'IGNORED')) {
      return NextResponse.json({ ok: true, dedup: true, previous_status: existing.status })
    }
  } catch (e: any) {
    // Tabela ainda não existe ou Prisma sem model → fallback raw SQL abaixo
  }

  // 4. Achar contact pelo email (multi-tenant: company_id pela env)
  const contact = await prisma.marketingContact.findFirst({
    where: { company_id: companyId, email: recipient },
    select: { id: true, tags: true, bounce_count: true, unsubscribed: true },
  })

  // 5. Aplicar update conforme event_type
  const updates: Record<string, any> = {}
  const tagsToAdd: string[] = []
  let processed = true
  let skipUpdate = false
  let bounceAtomic = false

  switch (eventType) {
    case 'email.delivered':
    case 'email.sent':
    case 'email.scheduled':
    case 'email.delivery_delayed':
      skipUpdate = true // só log
      break

    case 'email.opened':
      updates.last_opened_at = new Date()
      tagsToAdd.push('email:engaged')
      break

    case 'email.clicked':
      updates.last_clicked_at = new Date()
      tagsToAdd.push('email:engaged')
      break

    case 'email.bounced': {
      // Audit 14 fix: read-modify-write substituido por SQL atomic abaixo
      // (bounce_count + 1) com CASE pra setar unsubscribed em >=3. Race
      // anterior: 2 webhooks simultaneos calculavam mesmo newBounceCount
      // e gravavam N+1 quando deveria ser N+2.
      bounceAtomic = true
      tagsToAdd.push('email:bouncing')
      break
    }

    case 'email.complained':
      updates.unsubscribed = true
      updates.unsubscribed_at = new Date()
      tagsToAdd.push('email:complained')
      break

    case 'email.unsubscribed':
      updates.unsubscribed = true
      updates.unsubscribed_at = new Date()
      break

    default:
      processed = false
      break
  }

  // 6. Aplicar UPDATE em marketing_contacts (se houver contact + updates)
  if (contact && !skipUpdate && processed) {
    if (bounceAtomic) {
      // Audit 14 fix: bounce increment atomico — bounce_count = bounce_count + 1
      // e unsubscribed pula pra true quando atinge 3 num unico CASE. Evita
      // race de 2 webhooks simultaneos somando o mesmo valor previo.
      await prisma.$executeRaw`
        UPDATE marketing_contacts
        SET
          bounce_count = bounce_count + 1,
          unsubscribed = CASE WHEN bounce_count + 1 >= 3 THEN true ELSE unsubscribed END,
          unsubscribed_at = CASE WHEN bounce_count + 1 >= 3 AND unsubscribed = false THEN now() ELSE unsubscribed_at END,
          tags = (SELECT array_agg(DISTINCT t) FROM unnest(tags || ${tagsToAdd}::text[]) t)
        WHERE id = ${contact.id}
      `
    } else if (tagsToAdd.length > 0) {
      // merge tags via SQL nativo (array_agg DISTINCT) pra atomicidade
      await prisma.$executeRaw`
        UPDATE marketing_contacts
        SET
          tags = (SELECT array_agg(DISTINCT t) FROM unnest(tags || ${tagsToAdd}::text[]) t),
          last_opened_at = COALESCE(${updates.last_opened_at || null}::timestamptz, last_opened_at),
          last_clicked_at = COALESCE(${updates.last_clicked_at || null}::timestamptz, last_clicked_at),
          unsubscribed = COALESCE(${updates.unsubscribed ?? null}::boolean, unsubscribed),
          unsubscribed_at = COALESCE(${updates.unsubscribed_at || null}::timestamptz, unsubscribed_at)
        WHERE id = ${contact.id}
      `
    } else {
      await prisma.marketingContact.update({
        where: { id: contact.id },
        data: updates,
      })
    }
  }

  // 7. Salvar evento na marketing_webhook_event (sempre, mesmo se contact não existe)
  // Usa raw SQL pra evitar dependência do Prisma client ter o model gerado nesse momento.
  const status = !processed ? 'IGNORED' : skipUpdate ? 'PROCESSED' : contact ? 'PROCESSED' : 'PROCESSED'
  const lastError = !contact && processed && !skipUpdate ? 'contact not found for email' : null

  try {
    await prisma.$executeRaw`
      INSERT INTO marketing_webhook_event
        (company_id, provider, event_id, event_type, email, contact_id, raw_payload, signature, signature_valid, status, last_error, ip_address, processed_at)
      VALUES
        (${companyId}, 'resend', ${svixId}, ${eventType}, ${recipient}, ${contact?.id || null}, ${JSON.stringify(payload)}::jsonb, ${svixSignature}, ${true}, ${status}, ${lastError}, ${ipAddress}::inet, now())
      ON CONFLICT (provider, event_id) DO UPDATE
        SET status = EXCLUDED.status,
            processed_at = now(),
            last_error = EXCLUDED.last_error
    `
  } catch (e: any) {
    console.error('[Resend webhook] Failed to log event:', e?.message)
    // Não retornar erro — Resend re-entregaria. Update no contact já foi feito.
  }

  return NextResponse.json({ ok: true, event: eventType, contact_found: !!contact })
}

// GET pra health check / Resend verification
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'resend-webhook',
    secret_configured: !!process.env.RESEND_WEBHOOK_SECRET,
  })
}
