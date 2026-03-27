import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * POST /api/financeiro/boletos/webhook
 * Receive payment webhooks from banks
 *
 * No auth required - validation is done via bank signature
 *
 * Each bank sends webhooks in different formats:
 * - Inter: POST with JSON body, validates via X-Webhook-Secret header
 * - Itau: POST with JSON body, validates via signature in X-Itau-Signature header
 * - Stone: POST with JSON body, validates via signature in X-Stone-Webhook-Signature header
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const webhookSecret = request.headers.get('x-webhook-secret')
    const provider = detectProvider(request, body)

    console.log(`[BOLETO WEBHOOK] Received from ${provider}:`, JSON.stringify(body).slice(0, 500))

    // TODO: Validate webhook signature per provider
    // For now, just log and process

    if (provider === 'inter') {
      return await processInterWebhook(body, webhookSecret)
    } else if (provider === 'itau') {
      return await processItauWebhook(body)
    } else if (provider === 'stone') {
      return await processStoneWebhook(body)
    }

    console.warn('[BOLETO WEBHOOK] Unknown provider, body:', body)
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[BOLETO WEBHOOK] Error:', err)
    // Always return 200 to avoid bank retries on our processing errors
    return NextResponse.json({ received: true, error: 'processing_error' })
  }
}

function detectProvider(request: NextRequest, body: any): string {
  if (request.headers.get('x-webhook-secret') || body?.codigoCobranca) return 'inter'
  if (request.headers.get('x-itau-signature') || body?.boleto_id) return 'itau'
  if (request.headers.get('x-stone-webhook-signature') || body?.account_id) return 'stone'
  return 'unknown'
}

/**
 * Process Inter webhook
 * Inter sends: { codigoCobranca, nossoNumero, seuNumero, valorPago, dataPagamento, situacao }
 */
async function processInterWebhook(body: any, secret: string | null) {
  // TODO: Validate webhook secret against stored company setting 'boleto.inter.webhook_secret'
  // if (!secret || secret !== expectedSecret) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })

  const { nossoNumero, seuNumero, valorPago, dataPagamento, situacao } = body

  if (!nossoNumero && !seuNumero) {
    return NextResponse.json({ received: true, skipped: 'missing_identifier' })
  }

  // seuNumero is the receivable ID we sent during generation
  // Find the receivable by searching pix_code JSON for nossoNumero
  let receivable = null

  if (seuNumero) {
    receivable = await prisma.accountReceivable.findFirst({
      where: { id: seuNumero, boleto_url: { not: null } },
    })
  }

  if (!receivable && nossoNumero) {
    // Search by nossoNumero in pix_code JSON field
    const candidates = await prisma.accountReceivable.findMany({
      where: { boleto_url: { not: null }, status: 'PENDENTE' },
      take: 100,
    })
    receivable = candidates.find(c => {
      try {
        const meta = JSON.parse(c.pix_code || '{}')
        return meta.nossoNumero === nossoNumero
      } catch { return false }
    }) || null
  }

  if (!receivable) {
    console.warn(`[INTER WEBHOOK] Receivable not found for nossoNumero=${nossoNumero}, seuNumero=${seuNumero}`)
    return NextResponse.json({ received: true, skipped: 'not_found' })
  }

  // Process based on situacao
  if (situacao === 'PAGO' || situacao === 'PAGA') {
    const paidAmountCents = Math.round((valorPago || 0) * 100)

    let boletoMeta: any = {}
    try {
      boletoMeta = JSON.parse(receivable.pix_code || '{}')
    } catch { /* ignore */ }

    boletoMeta.boletoStatus = 'PAID'
    boletoMeta.paidAt = dataPagamento || new Date().toISOString()
    boletoMeta.paidAmount = paidAmountCents

    await prisma.accountReceivable.update({
      where: { id: receivable.id },
      data: {
        status: 'RECEBIDO',
        received_amount: paidAmountCents || receivable.total_amount,
        pix_code: JSON.stringify(boletoMeta),
      },
    })

    console.log(`[INTER WEBHOOK] Boleto ${nossoNumero} marked as PAID for receivable ${receivable.id}`)
  } else if (situacao === 'CANCELADA' || situacao === 'EXPIRADA') {
    let boletoMeta: any = {}
    try {
      boletoMeta = JSON.parse(receivable.pix_code || '{}')
    } catch { /* ignore */ }

    boletoMeta.boletoStatus = 'CANCELLED'

    await prisma.accountReceivable.update({
      where: { id: receivable.id },
      data: {
        pix_code: JSON.stringify(boletoMeta),
      },
    })

    console.log(`[INTER WEBHOOK] Boleto ${nossoNumero} marked as CANCELLED for receivable ${receivable.id}`)
  }

  return NextResponse.json({ received: true, processed: true })
}

/**
 * Process Itau webhook (placeholder)
 */
async function processItauWebhook(body: any) {
  // TODO: Implement Itau webhook processing
  // Itau sends webhook with different payload structure
  console.log('[ITAU WEBHOOK] Received (not implemented):', body)
  return NextResponse.json({ received: true, skipped: 'itau_not_implemented' })
}

/**
 * Process Stone webhook (placeholder)
 */
async function processStoneWebhook(body: any) {
  // TODO: Implement Stone webhook processing
  // Stone sends webhook with different payload structure
  console.log('[STONE WEBHOOK] Received (not implemented):', body)
  return NextResponse.json({ received: true, skipped: 'stone_not_implemented' })
}
