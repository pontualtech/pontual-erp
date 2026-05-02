import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Valida assinatura HMAC-SHA256 do webhook
 */
function validateWebhookSignature(payload: string, signature: string | null): boolean {
  const secret = process.env.BOLETO_WEBHOOK_SECRET
  if (!secret) {
    console.warn('[BOLETO WEBHOOK] BOLETO_WEBHOOK_SECRET nao configurado — rejeitando webhook')
    return false
  }
  if (!signature) return false

  const expectedSig = createHmac('sha256', secret).update(payload).digest('hex')

  try {
    const sigBuf = Buffer.from(signature, 'hex')
    const expectedBuf = Buffer.from(expectedSig, 'hex')
    if (sigBuf.length !== expectedBuf.length) return false
    return timingSafeEqual(sigBuf, expectedBuf)
  } catch {
    return false
  }
}

/**
 * POST /api/financeiro/boletos/webhook
 * Receive payment webhooks from banks
 *
 * Validates via HMAC-SHA256 signature (BOLETO_WEBHOOK_SECRET env var)
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-webhook-secret') ||
      request.headers.get('x-itau-signature') ||
      request.headers.get('x-stone-webhook-signature')

    // Validar assinatura HMAC
    if (!validateWebhookSignature(rawBody, signature)) {
      console.warn('[BOLETO WEBHOOK] Assinatura invalida ou ausente')
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
    }

    const body = JSON.parse(rawBody)
    const provider = detectProvider(request, body)

    console.log(`[BOLETO WEBHOOK] Received from ${provider}:`, rawBody.slice(0, 500))

    if (provider === 'inter') {
      return await processInterWebhook(body)
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
async function processInterWebhook(body: any) {
  const { nossoNumero, seuNumero, valorPago, dataPagamento, situacao } = body

  if (!nossoNumero && !seuNumero) {
    return NextResponse.json({ received: true, skipped: 'missing_identifier' })
  }

  // UX-10 #6: idempotência via WebhookEventLog (mesmo padrão Asaas Audit 2 #N9).
  // Antes: webhook duplicado podia sobrescrever received_amount com payload manipulado.
  // Note: company_id é resolvido após o lookup do receivable (linhas abaixo).
  // Aqui só pré-validamos via UNIQUE(provider, event_id) usando placeholder
  // company_id que será atualizado depois se receivable for encontrado.
  const eventId = `${nossoNumero || ''}:${seuNumero || ''}:${dataPagamento || ''}:${situacao || ''}`
  let logId: string | null = null
  if (eventId.replace(/:/g, '').length > 0) {
    try {
      // Tenta buscar receivable primeiro pra ter company_id
      const earlyReceivable = seuNumero
        ? await prisma.accountReceivable.findFirst({ where: { id: seuNumero }, select: { company_id: true } })
        : null
      if (earlyReceivable) {
        const log = await prisma.webhookEventLog.create({
          data: {
            company_id: earlyReceivable.company_id,
            provider: 'INTER_CNAB',
            event_id: eventId,
            event_type: situacao || 'UNKNOWN',
            status: 'PROCESSING',
            raw_payload: body,
          },
        })
        logId = log.id
      }
    } catch (err: any) {
      // P2002 = UNIQUE violation (provider+event_id) → dedup, retorno 200 OK
      if (err?.code === 'P2002') {
        console.log(`[INTER WEBHOOK] dedup event_id=${eventId}`)
        return NextResponse.json({ received: true, dedup: true })
      }
      // Outros erros: continua processando (não bloqueia webhook)
      console.warn(`[INTER WEBHOOK] WebhookEventLog write failed: ${err?.message}`)
    }
  }

  // seuNumero is the receivable ID we sent during generation
  // Find the receivable by searching pix_code JSON for nossoNumero
  let receivable = null

  if (seuNumero) {
    receivable = await prisma.accountReceivable.findFirst({
      where: { id: seuNumero, boleto_url: { not: null } },
      include: { companies: { select: { id: true, is_active: true } } },
    })
    // Reject if company is inactive (defense-in-depth)
    if (receivable && !(receivable as any).companies?.is_active) {
      console.warn(`[INTER WEBHOOK] Receivable ${seuNumero} belongs to inactive company`)
      receivable = null
    }
  }

  if (!receivable && nossoNumero && receivable === null) {
    // Fallback removed: searching ALL pending receivables by nossoNumero is too broad
    // and risks cross-tenant data access. The seuNumero lookup above should be sufficient.
    console.warn(`[INTER WEBHOOK] nossoNumero fallback skipped (cross-tenant risk) for nossoNumero=${nossoNumero}`)
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
