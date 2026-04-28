import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPaymentProvider } from '@/lib/payments/factory'
import { captureFeesForPayment } from '@/lib/payments/capture-fees'

// Valid status transitions — reject anything not in this map
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'RECEIVED', 'OVERDUE', 'DELETED', 'FAILED', 'CANCELLED'],
  OVERDUE: ['CONFIRMED', 'RECEIVED', 'DELETED', 'CANCELLED'],
  CONFIRMED: ['RECEIVED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
  RECEIVED: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  CANCELLED: [], // terminal — log conflict if payment arrives after cancel
}

// Map Asaas webhook events to internal payment status
const EVENT_STATUS_MAP: Record<string, string> = {
  PAYMENT_RECEIVED: 'RECEIVED',
  PAYMENT_CONFIRMED: 'CONFIRMED',
  PAYMENT_OVERDUE: 'OVERDUE',
  PAYMENT_REFUNDED: 'REFUNDED',
  PAYMENT_PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  PAYMENT_DELETED: 'DELETED',
  PAYMENT_FAILED: 'FAILED',
  PAYMENT_CANCELLED: 'CANCELLED',
}

// Only RECEIVED triggers auto-baixa (not CONFIRMED)
// CONFIRMED = payment made but funds not yet available (boleto/cartão D+1 to D+3)
// RECEIVED = funds available — this is the definitive event
const AUTO_BAIXA_STATUS = 'RECEIVED'

// GET handler — Asaas tests webhook URL with GET before saving
export async function GET() {
  return NextResponse.json({ ok: true, message: 'Webhook endpoint active' })
}

// Webhook endpoint — public, no auth, validates signature
export async function POST(req: NextRequest) {
  const body = await req.text()
  let parsedBody: Record<string, any> = {}

  try {
    parsedBody = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = parsedBody.event as string | undefined
  const asaasPayment = parsedBody.payment as Record<string, any> | undefined

  // 1. Validate webhook signature
  const provider = getPaymentProvider()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => { headers[key] = value })

  if (!provider.validateWebhook(headers, body)) {
    console.warn('[Webhook] Invalid signature from', req.headers.get('user-agent'))
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 2. Check if this is a handled event
  const newStatus = event ? EVENT_STATUS_MAP[event] : undefined
  if (!newStatus || !asaasPayment) {
    try {
      await prisma.webhookLog.create({
        data: {
          company_id: 'unknown',
          event: event || 'UNKNOWN',
          asaas_event_id: (parsedBody.id as string) || null,
          payload: parsedBody,
          status: 'IGNORED',
        },
      })
    } catch { /* non-critical */ }
    return NextResponse.json({ ok: true })
  }

  // 3. Find payment by external_id (Asaas payment.id)
  const externalId = asaasPayment.id as string
  if (!externalId) {
    return NextResponse.json({ ok: true })
  }

  let payment = await prisma.payment.findFirst({
    where: { external_id: externalId },
  })

  // Fallback: try externalReference (idempotency key)
  if (!payment) {
    const extRef = asaasPayment.externalReference as string | undefined
    if (extRef) {
      payment = await prisma.payment.findFirst({
        where: { idempotency_key: extRef },
      })
    }
  }

  if (!payment) {
    try {
      await prisma.webhookLog.create({
        data: {
          company_id: 'unknown',
          event: event!,
          asaas_event_id: (parsedBody.id as string) || null,
          payload: parsedBody,
          status: 'IGNORED',
          error: `Payment not found: external_id=${externalId}`,
        },
      })
    } catch { /* non-critical */ }
    return NextResponse.json({ ok: true })
  }

  // 4. Create WebhookLog (always, before processing)
  let webhookLogId: string | null = null
  try {
    const log = await prisma.webhookLog.create({
      data: {
        company_id: payment.company_id,
        event: event!,
        payment_id: payment.id,
        asaas_event_id: (parsedBody.id as string) || null,
        payload: parsedBody,
        status: 'RECEIVED',
      },
    })
    webhookLogId = log.id
  } catch { /* non-critical */ }

  // 5-7. Process INSIDE transaction for atomicity + idempotency
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-read payment inside transaction for atomicity (prevents double-processing)
      const fresh = await tx.payment.findUnique({ where: { id: payment!.id } })
      if (!fresh) return { action: 'skip', reason: 'Payment disappeared' }

      // Idempotency: already at this status
      if (fresh.status === newStatus) {
        return { action: 'skip', reason: 'Already at status' }
      }

      // Validate status transition
      const validNext = VALID_TRANSITIONS[fresh.status] || []
      if (!validNext.includes(newStatus)) {
        // Special case: payment received AFTER local cancellation — log as conflict
        if (fresh.status === 'CANCELLED' && (newStatus === 'RECEIVED' || newStatus === 'CONFIRMED')) {
          console.error(`[Webhook] CONFLICT: Payment ${fresh.id} was cancelled locally but ${event} received from Asaas. Manual review needed.`)
          return { action: 'conflict', reason: `${fresh.status} → ${newStatus}` }
        }
        return { action: 'skip', reason: `Invalid transition: ${fresh.status} → ${newStatus}` }
      }

      // Update payment status
      const paymentUpdate: Record<string, any> = {
        status: newStatus,
        updated_at: new Date(),
      }

      if (newStatus === AUTO_BAIXA_STATUS || newStatus === 'CONFIRMED') {
        paymentUpdate.paid_at = asaasPayment.paymentDate
          ? new Date(asaasPayment.paymentDate as string)
          : new Date()
      }

      if (newStatus === 'REFUNDED') {
        paymentUpdate.refunded_at = new Date()
      }

      if (newStatus === 'CANCELLED' || newStatus === 'DELETED') {
        paymentUpdate.cancelled_at = new Date()
      }

      await tx.payment.update({
        where: { id: fresh.id },
        data: paymentUpdate,
      })

      // Auto-baixa: ONLY on RECEIVED (not CONFIRMED — prevents double-credit for credit card)
      if (newStatus === AUTO_BAIXA_STATUS && fresh.receivable_id) {
        const receivable = await tx.accountReceivable.findFirst({
          where: { id: fresh.receivable_id, company_id: fresh.company_id },
        })

        if (receivable && receivable.status !== 'RECEBIDO') {
          const newReceived = (receivable.received_amount || 0) + fresh.amount
          const isFullyPaid = newReceived >= receivable.total_amount

          await tx.accountReceivable.update({
            where: { id: fresh.receivable_id },
            data: {
              received_amount: newReceived,
              status: isFullyPaid ? 'RECEBIDO' : 'PENDENTE',
              charge_status: newStatus,
              payment_method: fresh.billing_type || fresh.method || receivable.payment_method,
              updated_at: new Date(),
            },
          })

          // Append nas obs internas da OS — historico visivel pro atendente
          if (fresh.service_order_id) {
            const so = await tx.serviceOrder.findUnique({
              where: { id: fresh.service_order_id },
              select: { internal_notes: true },
            })
            const valorBRL = (fresh.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            const dataStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
            const metodo = fresh.billing_type || fresh.method || 'PIX'
            const novaNota = `[${dataStr}] ✓ Pagamento confirmado: ${metodo} ${valorBRL} — Asaas ${asaasPayment.id}`
            const notesAtual = so?.internal_notes ? so.internal_notes + '\n' : ''
            await tx.serviceOrder.update({
              where: { id: fresh.service_order_id },
              data: { internal_notes: notesAtual + novaNota },
            })
          }
        }
      }

      // Handle CONFIRMED: update charge_status but do NOT increment received_amount
      if (newStatus === 'CONFIRMED' && fresh.receivable_id) {
        await tx.accountReceivable.update({
          where: { id: fresh.receivable_id },
          data: {
            charge_status: 'CONFIRMED',
            updated_at: new Date(),
          },
        })
      }

      // Handle OVERDUE
      if (newStatus === 'OVERDUE' && fresh.receivable_id) {
        await tx.accountReceivable.update({
          where: { id: fresh.receivable_id },
          data: {
            charge_status: 'OVERDUE',
            updated_at: new Date(),
          },
        })
      }

      // Handle REFUNDED: reverse the auto-baixa
      if (newStatus === 'REFUNDED' && fresh.receivable_id) {
        const receivable = await tx.accountReceivable.findFirst({
          where: { id: fresh.receivable_id, company_id: fresh.company_id },
        })

        if (receivable) {
          const newReceived = Math.max(0, (receivable.received_amount || 0) - fresh.amount)
          await tx.accountReceivable.update({
            where: { id: fresh.receivable_id },
            data: {
              received_amount: newReceived,
              status: newReceived >= receivable.total_amount ? 'RECEBIDO' : 'PENDENTE',
              charge_status: 'REFUNDED',
              updated_at: new Date(),
            },
          })
        }
      }

      // Handle DELETED/CANCELLED: clear charge info from receivable
      if ((newStatus === 'DELETED' || newStatus === 'CANCELLED') && fresh.receivable_id) {
        await tx.accountReceivable.update({
          where: { id: fresh.receivable_id },
          data: {
            charge_id: null,
            charge_status: null,
            charge_url: null,
            updated_at: new Date(),
          },
        })
      }

      // Audit log — use 'system:webhook' instead of customer_id
      await tx.auditLog.create({
        data: {
          company_id: fresh.company_id,
          user_id: 'system:webhook',
          module: 'financeiro',
          action: `payment_${newStatus.toLowerCase()}`,
          entity_id: fresh.receivable_id || fresh.service_order_id || fresh.id,
          new_value: {
            payment_id: fresh.id,
            amount: fresh.amount,
            method: fresh.method,
            billing_type: fresh.billing_type,
            provider: fresh.provider,
            receivable_id: fresh.receivable_id,
            webhook_event: event,
            asaas_payment_id: asaasPayment.id,
          },
        },
      })

      return { action: 'processed', reason: `${fresh.status} → ${newStatus}` }
    })

    // Update webhook log based on result
    if (webhookLogId) {
      const logStatus = result.action === 'processed' ? 'PROCESSED'
        : result.action === 'conflict' ? 'FAILED'
        : 'IGNORED'
      try {
        await prisma.webhookLog.update({
          where: { id: webhookLogId },
          data: {
            status: logStatus,
            error: result.action !== 'processed' ? result.reason : null,
            processed_at: new Date(),
          },
        })
      } catch { /* non-critical */ }
    }

    console.log(`[Webhook] ${event}: Payment ${payment.id} → ${result.action} (${result.reason})`)

    // Capturar taxas do gateway (transacao + notificacoes) e gravar 1
    // AccountPayable consolidado. Fora da transacao Prisma — fetch externo.
    // Fire-and-forget: erros nao revertem a baixa.
    if (result.action === 'processed' && newStatus === 'RECEIVED' && payment.receivable_id) {
      ;(async () => {
        try {
          const r = await captureFeesForPayment(payment)
          if (r.ok && r.fees_count > 0) {
            console.log(`[Fees] payment ${payment.id} capturado: ${r.fees_count} fees → AP ${r.ap_id}`)
          } else if (!r.ok) {
            console.warn(`[Fees] payment ${payment.id} falhou: ${r.error}`)
          }
        } catch (e) {
          console.error('[Fees] erro inesperado:', e)
        }
      })()
    }

    // Notificar cliente que pagamento foi recebido (fire-and-forget).
    // Dispara em RECEIVED (auto-baixa, fundos disponiveis) — nao em CONFIRMED.
    if (result.action === 'processed' && result.reason && /→ RECEIVED$/.test(result.reason)) {
      ;(async () => {
        try {
          const paymentFresh = await prisma.payment.findUnique({
            where: { id: payment.id },
            select: {
              amount: true,
              billing_type: true,
              method: true,
              service_order_id: true,
              company_id: true,
              service_orders: {
                select: {
                  id: true,
                  os_number: true,
                  customer_id: true,
                  equipment_type: true,
                  equipment_brand: true,
                  equipment_model: true,
                  customers: { select: { id: true, legal_name: true, email: true, mobile: true, phone: true } },
                  companies: { select: { name: true, slug: true } },
                },
              },
            },
          })
          const so = paymentFresh?.service_orders
          if (!so || !paymentFresh) return
          const customer = so.customers
          if (!customer) return

          const valorBRL = (paymentFresh.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          const osNum = String(so.os_number).padStart(4, '0')
          const equipment = [so.equipment_type, so.equipment_brand, so.equipment_model].filter(Boolean).join(' ') || 'Equipamento'
          const metodo = paymentFresh.billing_type || paymentFresh.method || 'PIX'
          const companyName = so.companies?.name || 'PontualTech'
          const slug = so.companies?.slug || 'pontualtech'

          const { buildMagicLink: bmlPay } = await import('@/lib/portal-magic-url')
          const ml = bmlPay({ customerId: customer.id, companyId: paymentFresh.company_id, slug, osId: so.id })

          // WhatsApp (texto livre — pagamento confirmado e dentro de janela 24h
          // ou via Evolution fallback se Cloud nao disponivel)
          const phone = customer.mobile || customer.phone
          if (phone) {
            const firstName = (customer.legal_name || 'Cliente').split(' ')[0]
            const msg = `Ola, ${firstName}! Confirmamos o recebimento do pagamento.\n\n*Pagamento confirmado*\nValor: ${valorBRL}\nForma: ${metodo}\nOS #${osNum} — ${equipment}\n\nAcompanhar OS:\n${ml.url}\n\n_Equipe ${companyName}_`
            const { sendWhatsAppCloud } = await import('@/lib/whatsapp/cloud-api')
            sendWhatsAppCloud(paymentFresh.company_id, phone, msg).catch(() => {})
          }

          // Email
          if (customer.email) {
            const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f5;padding:20px;">
              <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
                <div style="background:#059669;padding:24px 32px;color:#fff;">
                  <h1 style="margin:0;font-size:20px;">${companyName}</h1>
                  <p style="margin:4px 0 0;font-size:14px;">Pagamento confirmado — OS #${osNum}</p>
                </div>
                <div style="padding:32px;">
                  <p>Ola, <strong>${customer.legal_name || 'Cliente'}</strong>!</p>
                  <p>Confirmamos o recebimento do seu pagamento. Obrigado pela confianca!</p>
                  <table width="100%" cellpadding="8" style="background:#f9fafb;border-radius:6px;margin:16px 0;">
                    <tr><td>Valor</td><td style="text-align:right;font-weight:bold;">${valorBRL}</td></tr>
                    <tr><td>Forma</td><td style="text-align:right;">${metodo}</td></tr>
                    <tr><td>OS</td><td style="text-align:right;">#${osNum}</td></tr>
                    <tr><td>Equipamento</td><td style="text-align:right;">${equipment}</td></tr>
                  </table>
                  <a href="${ml.url}" style="display:block;text-align:center;background:#2563eb;color:#fff;padding:14px;border-radius:6px;text-decoration:none;font-weight:bold;">Acompanhar OS no portal</a>
                </div>
              </div>
            </body></html>`
            const { sendCompanyEmail } = await import('@/lib/send-email')
            sendCompanyEmail(paymentFresh.company_id, customer.email, `Pagamento confirmado — OS #${osNum} — ${companyName}`, html).catch(() => {})
          }
        } catch (e: any) {
          console.error('[Webhook payment notify] falhou:', e?.message)
        }
      })()
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Webhook] Transaction error:', err)

    if (webhookLogId) {
      try {
        await prisma.webhookLog.update({
          where: { id: webhookLogId },
          data: {
            status: 'FAILED',
            error: err instanceof Error ? err.message : 'Transaction failed',
            processed_at: new Date(),
          },
        })
      } catch { /* non-critical */ }
    }

    // Return 500 so Asaas retries (up to 3x)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
