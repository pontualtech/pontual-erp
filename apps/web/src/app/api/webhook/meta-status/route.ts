import { NextRequest, NextResponse } from 'next/server'

/**
 * Meta WhatsApp Cloud API — Status webhook receiver.
 *
 * Recebe eventos de status (sent / delivered / read / failed) das
 * mensagens enviadas via Cloud API. Sem esse webhook, o sistema so sabe
 * "Meta aceitou a chamada" — nao sabe se a mensagem foi entregue ao cliente.
 *
 * Configurar em Meta Business Suite:
 *   - Webhook URL: https://erp.pontualtech.work/api/webhook/meta-status
 *   - Verify Token: env META_WEBHOOK_VERIFY_TOKEN
 *   - Eventos: message_status_updates
 *
 * Log estruturado com prefixo [Meta Status] permite filtrar via Coolify
 * pra correlacionar messageId -> delivery status.
 */

// GET: Meta verification handshake
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN
  if (!expectedToken) {
    console.warn('[Meta Status] META_WEBHOOK_VERIFY_TOKEN nao configurado — rejeitando handshake')
    return new NextResponse('verify_token not configured', { status: 500 })
  }

  if (mode === 'subscribe' && token === expectedToken && challenge) {
    console.log('[Meta Status] Webhook verified successfully')
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  console.warn('[Meta Status] Verification failed — mode:', mode, 'token_match:', token === expectedToken)
  return new NextResponse('forbidden', { status: 403 })
}

// POST: receive status events
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json({ ignored: true }, { status: 200 })
    }

    const entries = body.entry || []
    let statusCount = 0
    let messageCount = 0

    for (const entry of entries) {
      const changes = entry.changes || []
      for (const change of changes) {
        const value = change.value || {}

        // Status updates (sent / delivered / read / failed)
        const statuses = value.statuses || []
        for (const st of statuses) {
          statusCount++
          const errors = st.errors || []
          const errorSummary = errors.length > 0
            ? errors.map((e: any) => `code=${e.code} ${e.title || ''} ${e.message || e.error_data?.details || ''}`.trim()).join(' | ')
            : null

          console.log('[Meta Status]', JSON.stringify({
            messageId: st.id,
            status: st.status,
            recipient: st.recipient_id,
            timestamp: st.timestamp,
            conversation_origin: st.conversation?.origin?.type,
            pricing_category: st.pricing?.category,
            errors: errorSummary,
          }))
        }

        // Inbound messages (informational only; we have other handlers for these)
        const messages = value.messages || []
        for (const msg of messages) {
          messageCount++
          console.log('[Meta Inbound]', JSON.stringify({
            messageId: msg.id,
            from: msg.from,
            type: msg.type,
            timestamp: msg.timestamp,
          }))
        }
      }
    }

    return NextResponse.json({ received: true, statuses: statusCount, messages: messageCount }, { status: 200 })
  } catch (err: any) {
    // Meta retries on non-2xx, so log and return 200 to avoid retry storms.
    console.error('[Meta Status] Error processing webhook:', err.message)
    return NextResponse.json({ error: err.message }, { status: 200 })
  }
}
