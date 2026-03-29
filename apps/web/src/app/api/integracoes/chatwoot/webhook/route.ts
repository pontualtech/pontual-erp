import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createHmac, timingSafeEqual } from 'crypto'

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

  // Auto-sync contact to ERP (fire and forget)
  const sender = body.sender || body.conversation?.meta?.sender || {}
  syncContactToERP(sender).catch(() => {})

  // Check for OS number patterns: OS-0001, #0001, OS 1234
  const osMatch = message.match(/(?:OS[-\s]?|#)(\d{1,6})/i)

  if (osMatch) {
    const osNumber = parseInt(osMatch[1], 10)
    console.log(`[Chatwoot Webhook] OS number detected: ${osNumber}`)

    // Try to find the OS in the database
    const os = await prisma.serviceOrder.findFirst({
      where: { os_number: osNumber, deleted_at: null },
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
  const contact = body.contact || body.conversation?.meta?.sender || {}
  await syncContactToERP(contact)
}

// Auto-save Chatwoot contacts to ERP as customers
async function syncContactToERP(contact: any) {
  if (!contact) return

  const phone = (contact.phone_number || '').replace(/\D/g, '')
  const name = contact.name || contact.identifier || ''
  const email = contact.email || ''

  if (!phone && !name) return

  const cleanPhone = phone.slice(-10) // Last 10 digits
  if (cleanPhone.length < 10 && !email) return

  // Find the first company (for multi-tenant)
  const company = await prisma.company.findFirst({ where: { is_active: true } })
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
  console.log(`[Chatwoot Sync] Created customer: ${name} (${phone})`)
}
