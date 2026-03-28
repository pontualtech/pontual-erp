import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const event = body.event

    console.log(`[Chatwoot Webhook] Event: ${event}`, JSON.stringify(body).slice(0, 500))

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
  const phone = contact.phone_number || ''

  if (!phone) return

  // Normalize phone for search
  const cleanPhone = phone.replace(/\D/g, '').slice(-10) // Last 10 digits

  if (cleanPhone.length < 10) return

  // Try to match with ERP customer
  const customer = await prisma.customer.findFirst({
    where: {
      deleted_at: null,
      OR: [
        { mobile: { contains: cleanPhone } },
        { phone: { contains: cleanPhone } },
      ],
    },
  })

  if (customer) {
    console.log(`[Chatwoot Webhook] Matched contact ${phone} to customer: ${customer.legal_name} (${customer.id})`)
  } else {
    console.log(`[Chatwoot Webhook] No ERP customer found for phone: ${phone}`)
  }
}
