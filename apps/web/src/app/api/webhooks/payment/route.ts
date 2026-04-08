import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPaymentProvider } from '@/lib/payments/factory'

// Webhook endpoint — public, no auth, validates signature
export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const provider = getPaymentProvider()

    // Validate webhook signature
    const headers: Record<string, string> = {}
    req.headers.forEach((value, key) => { headers[key] = value })

    if (!provider.validateWebhook(headers, body)) {
      console.warn('[Webhook] Invalid signature from', req.headers.get('user-agent'))
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    // Parse webhook
    const payload = provider.parseWebhook(body)

    if (!payload.externalId) {
      return NextResponse.json({ error: 'Missing externalId' }, { status: 400 })
    }

    // Find payment by external_id
    const payment = await prisma.payment.findFirst({
      where: { external_id: payload.externalId },
    })

    if (!payment) {
      console.warn('[Webhook] Payment not found:', payload.externalId)
      return NextResponse.json({ ok: true }) // 200 to stop retries
    }

    // Idempotency: ignore if already confirmed
    if (payment.status === 'CONFIRMED') {
      return NextResponse.json({ ok: true, already_processed: true })
    }

    // Update payment status
    const updateData: Record<string, unknown> = {
      status: payload.status === 'CONFIRMED' ? 'CONFIRMED' : payload.status,
      updated_at: new Date(),
    }

    if (payload.status === 'CONFIRMED') {
      updateData.paid_at = payload.paidAt ? new Date(payload.paidAt) : new Date()
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: updateData,
    })

    // If confirmed, log in audit
    if (payload.status === 'CONFIRMED') {
      await prisma.auditLog.create({
        data: {
          company_id: payment.company_id,
          user_id: payment.customer_id,
          module: 'portal',
          action: 'payment_confirmed',
          entity_id: payment.service_order_id,
          new_value: {
            payment_id: payment.id,
            amount: payment.amount,
            method: payment.method,
            provider: payment.provider,
          },
        },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Webhook Payment Error]', err)
    return NextResponse.json({ ok: true }) // 200 to prevent retries on server error
  }
}
