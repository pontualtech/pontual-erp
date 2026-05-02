import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createHmac, timingSafeEqual } from 'crypto'
import { redactName, redactPhone } from '@/lib/log-redact'

/**
 * C7 fix (audit): resolve company_id corretamente via inbox_id/account_id
 * do payload Chatwoot, em vez de fallback `findFirst({is_active:true})` que
 * roteava todos os contatos cross-tenant pra primeira empresa ativa.
 *
 * Estratégia (em ordem de prioridade):
 *   1. Setting `chatwoot.inbox_${inbox_id}.company_id` — mapping per-inbox
 *   2. Setting `chatwoot.account_${account_id}.company_id` — mapping per-account
 *   3. Env var `CHATWOOT_INBOX_${inbox_id}_COMPANY_ID` — bootstrap antes do admin UI
 *   4. Fallback `findFirst({is_active:true})` COM WARNING — preserva backward compat
 *      mas torna o problema visível em log.
 *
 * Retorna null se nenhuma estratégia resolver. Caller deve abortar o processamento.
 */
async function resolveCompanyForChatwoot(payload: any): Promise<string | null> {
  const inboxId = payload?.inbox?.id ?? payload?.conversation?.inbox_id ?? payload?.inbox_id
  const accountId = payload?.account?.id ?? payload?.account_id

  // 1. Setting per-inbox
  if (inboxId) {
    const s = await prisma.setting.findFirst({
      where: { key: `chatwoot.inbox_${inboxId}.company_id` },
      select: { company_id: true, value: true },
    })
    if (s?.value) return s.value
  }

  // 2. Setting per-account
  if (accountId) {
    const s = await prisma.setting.findFirst({
      where: { key: `chatwoot.account_${accountId}.company_id` },
      select: { company_id: true, value: true },
    })
    if (s?.value) return s.value
  }

  // 3. Env var fallback
  if (inboxId) {
    const envKey = `CHATWOOT_INBOX_${inboxId}_COMPANY_ID`
    const envValue = process.env[envKey]
    if (envValue) return envValue
  }

  // 4. Final fallback com warning (cross-tenant leak risk em multi-tenant)
  const company = await prisma.company.findFirst({ where: { is_active: true }, select: { id: true } })
  if (!company) return null
  console.warn(`[Chatwoot Webhook] FALLBACK cross-tenant: inbox_id=${inboxId} account_id=${accountId} → ${company.id}. Configurar setting 'chatwoot.inbox_${inboxId}.company_id' pra desambiguar.`)
  return company.id
}

/**
 * Valida assinatura do webhook Chatwoot (HMAC-SHA256)
 */
function validateChatwootSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.CHATWOOT_WEBHOOK_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Chatwoot Webhook] CHATWOOT_WEBHOOK_SECRET obrigatorio em producao — rejeitando')
      return false
    }
    console.warn('[Chatwoot Webhook] CHATWOOT_WEBHOOK_SECRET nao configurado — aceitando apenas em dev')
    return true
  }
  if (!signature) return false

  const expectedSig = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSig)
    )
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()

    // Validar assinatura do webhook
    const signature = req.headers.get('x-chatwoot-signature')
    if (!validateChatwootSignature(rawBody, signature)) {
      console.warn('[Chatwoot Webhook] Assinatura invalida')
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
    }

    const body = JSON.parse(rawBody)
    const event = body.event

    console.log(`[Chatwoot Webhook] Event: ${event}`, rawBody.slice(0, 500))

    if (event === 'message_created') {
      await handleMessageCreated(body)
    } else if (event === 'conversation_created') {
      await handleConversationCreated(body)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Chatwoot Webhook] Error:', err)
    // Always return 200 to Chatwoot so it doesn't retry
    return NextResponse.json({ ok: true })
  }
}

async function handleMessageCreated(body: any) {
  const message = body.content || body.conversation?.messages?.[0]?.content || ''
  const messageType = body.message_type

  // Only process incoming messages (from customer)
  if (messageType !== 'incoming') return

  // C7: resolve tenant ANTES de qualquer processamento — evita cross-tenant leak
  const resolvedCompanyId = await resolveCompanyForChatwoot(body)
  if (!resolvedCompanyId) {
    console.warn('[Chatwoot Webhook] Não conseguiu resolver company_id — pulando mensagem')
    return
  }

  // Auto-sync contact to ERP (fire and forget) — passa companyId explícito
  const sender = body.sender || body.conversation?.meta?.sender || {}
  syncContactToERP(sender, resolvedCompanyId).catch(() => {})

  // Check for OS number patterns: OS-0001, #0001, OS 1234
  const osMatch = message.match(/(?:OS[-\s]?|#)(\d{1,6})/i)

  if (osMatch) {
    const osNumber = parseInt(osMatch[1], 10)
    console.log(`[Chatwoot Webhook] OS number detected: ${osNumber} (company=${resolvedCompanyId})`)

    // C7: scope por company_id pra evitar achar OS de outro tenant com mesmo número
    const os = await prisma.serviceOrder.findFirst({
      where: { os_number: osNumber, company_id: resolvedCompanyId, deleted_at: null },
      include: { customers: true, module_statuses: true },
    })

    if (os) {
      console.log(`[Chatwoot Webhook] Found OS-${String(osNumber).padStart(4, '0')}, status: ${os.module_statuses?.name}`)

      // Check for approval keywords
      const lowerMessage = message.toLowerCase()
      const isApproval = lowerMessage.includes('aprovar') || lowerMessage.includes('aprovado') || lowerMessage.includes('aprovo')

      if (isApproval && os.module_statuses?.name === 'Aguardando Aprovacao') {
        // Find the "Aprovada" status
        const approvedStatus = await prisma.moduleStatus.findFirst({
          where: {
            company_id: os.company_id,
            module: 'os',
            name: { in: ['Aprovada', 'Aprovado', 'Em Andamento'] },
          },
          orderBy: { order: 'asc' },
        })

        if (approvedStatus) {
          await prisma.$transaction([
            prisma.serviceOrder.update({
              where: { id: os.id },
              data: { status_id: approvedStatus.id },
            }),
            prisma.serviceOrderHistory.create({
              data: {
                company_id: os.company_id,
                service_order_id: os.id,
                from_status_id: os.status_id,
                to_status_id: approvedStatus.id,
                changed_by: 'system-chatwoot',
                notes: 'Aprovado automaticamente via WhatsApp/Chatwoot',
              },
            }),
          ])
          console.log(`[Chatwoot Webhook] OS-${String(osNumber).padStart(4, '0')} auto-approved`)
        }
      }
    }
  }
}

async function handleConversationCreated(body: any) {
  // C7: resolve tenant via inbox_id/account_id antes de sync
  const resolvedCompanyId = await resolveCompanyForChatwoot(body)
  if (!resolvedCompanyId) {
    console.warn('[Chatwoot Webhook] conversation_created sem tenant resolvido — skip')
    return
  }
  const contact = body.contact || body.conversation?.meta?.sender || {}
  await syncContactToERP(contact, resolvedCompanyId)
}

// Auto-save Chatwoot contacts to ERP as customers
async function syncContactToERP(contact: any, companyId: string) {
  if (!contact) return
  if (!companyId) return

  const phone = (contact.phone_number || '').replace(/\D/g, '')
  const name = contact.name || contact.identifier || ''
  const email = contact.email || ''

  if (!phone && !name) return

  const cleanPhone = phone.slice(-10) // Last 10 digits
  if (cleanPhone.length < 10 && !email) return

  // C7: usa companyId resolvido (não findFirst is_active)
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } })
  if (!company) return

  // Search by phone or email
  const whereConditions: any[] = []
  if (cleanPhone.length >= 10) {
    whereConditions.push({ mobile: { contains: cleanPhone } })
    whereConditions.push({ phone: { contains: cleanPhone } })
  }
  if (email) {
    whereConditions.push({ email: { equals: email, mode: 'insensitive' } })
  }

  if (whereConditions.length === 0) return

  const existing = await prisma.customer.findFirst({
    where: {
      company_id: company.id,
      deleted_at: null,
      OR: whereConditions,
    },
  })

  if (existing) {
    // Update name/email if we have better data
    const updates: any = {}
    if (email && !existing.email) updates.email = email
    if (name && name.length > (existing.legal_name?.length || 0) && name !== '.') updates.legal_name = name

    if (Object.keys(updates).length > 0) {
      await prisma.customer.update({ where: { id: existing.id }, data: updates })
      console.log(`[Chatwoot Sync] Updated customer ${existing.id}: ${JSON.stringify(updates)}`)
    }
    return
  }

  // Create new customer from Chatwoot contact
  if (!name || name === '.') return // Skip unnamed contacts

  await prisma.customer.create({
    data: {
      company_id: company.id,
      legal_name: name,
      person_type: 'FISICA',
      customer_type: 'CLIENTE',
      mobile: phone || null,
      email: email || null,
      notes: 'Cadastrado automaticamente via WhatsApp/Chatwoot',
    },
  })
  console.log(`[Chatwoot Sync] Created customer: ${redactName(name)} (${redactPhone(phone)})`)
}
