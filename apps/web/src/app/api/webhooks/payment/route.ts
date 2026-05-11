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
  // 2026-05-11: CANCELLED -> DELETED aceito como idempotente. Cenario:
  // atendente cancela via /charge/[id]/cancel (Payment local vira CANCELLED
  // e Asaas tambem cancela). Asaas envia PAYMENT_DELETED webhook depois —
  // antes caia em "Invalid transition" e logava warning falso. Agora aceita.
  CANCELLED: ['DELETED'],
}

// Map Asaas webhook events to internal payment status
// UX-11 #9: incluídos eventos de chargeback/dispute — antes ficavam em IGNORED
// silencioso, R$ chargebacks não eram refletidos no AR/DRE.
const EVENT_STATUS_MAP: Record<string, string> = {
  PAYMENT_RECEIVED: 'RECEIVED',
  PAYMENT_CONFIRMED: 'CONFIRMED',
  PAYMENT_OVERDUE: 'OVERDUE',
  PAYMENT_REFUNDED: 'REFUNDED',
  PAYMENT_PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  PAYMENT_DELETED: 'DELETED',
  PAYMENT_FAILED: 'FAILED',
  PAYMENT_CANCELLED: 'CANCELLED',
  // Chargeback flow (cartão de crédito disputado pelo cliente)
  PAYMENT_CHARGEBACK_REQUESTED: 'DISPUTED',
  PAYMENT_CHARGEBACK_DISPUTE: 'DISPUTED',
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'DISPUTED',
  // Refund flow
  PAYMENT_REFUND_IN_PROGRESS: 'REFUND_PENDING',
  // Régua Asaas (cobrança)
  PAYMENT_DUNNING_RECEIVED: 'RECEIVED',
  PAYMENT_DUNNING_REQUESTED: 'OVERDUE',
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

  // C6 fix (audit): Dedup por asaas_event_id usando WebhookEventLog (M-003).
  // Asaas oficialmente retenta webhook 3x. Antes só dependíamos de
  // VALID_TRANSITIONS pra idempotência por status — frágil em casos
  // PARCIAL→PAGO ou quando o mesmo event_id chega 2x. Agora:
  //   1. Check existência em WebhookEventLog (provider+event_id UNIQUE)
  //   2. Se status=PROCESSED/IGNORED → return 200 dedup (já tratado antes)
  //   3. Se status=FAILED/RECEIVED → permite reprocesso (retry do Asaas após
  //      falha precisa ser permitido)
  //   4. Se não existir → INSERT abaixo, UNIQUE constraint protege contra race
  //   5. P2002 violation → race won por outro request → return 200 dedup
  //
  // WebhookLog legado continua sendo escrito pra compatibilidade/observabilidade.
  const asaasEventId = (parsedBody.id as string) || null
  let existingEventLogId: string | null = null
  if (asaasEventId) {
    try {
      const existing = await prisma.webhookEventLog.findUnique({
        where: { provider_event_id: { provider: 'ASAAS', event_id: asaasEventId } },
        select: { id: true, status: true, attempts: true },
      })
      if (existing) {
        // Statuses terminais: já processado ou ignorado, não reprocessa
        if (existing.status === 'PROCESSED' || existing.status === 'IGNORED') {
          return NextResponse.json({
            ok: true,
            dedup: true,
            previous_status: existing.status,
          })
        }
        // FAILED/RECEIVED: permite retry — apenas marca pra atualizar abaixo
        existingEventLogId = existing.id
      }
    } catch (e: any) {
      // Tabela WebhookEventLog não existir não deve quebrar webhook —
      // fallback pra fluxo legacy abaixo. Loga só o erro.
      console.warn('[Webhook] WebhookEventLog dedup check failed:', e?.message)
    }
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
  // N8 fix (audit pos-fix): idempotency_key tem UNIQUE GLOBAL com pattern
  // previsível (`charge_<receivable_id>`). Se atacante envia webhook spoofado
  // com externalReference de outro tenant + signature válida (API key vazada),
  // resolveria payment cross-tenant. Mitigação: depois do match, valida que
  // payment.external_id == externalId atual OU está vazio (recém-criado).
  // Mismatch = log warning + reject (NÃO processar).
  if (!payment) {
    const extRef = asaasPayment.externalReference as string | undefined
    if (extRef) {
      const candidate = await prisma.payment.findFirst({
        where: { idempotency_key: extRef },
      })
      if (candidate) {
        // Valida que external_id é nulo (payment ainda não vinculado ao Asaas)
        // OU bate com o externalId atual. Senão é tentativa de cross-tenant
        // poisoning via reference colidente.
        if (!candidate.external_id || candidate.external_id === externalId) {
          payment = candidate
        } else {
          console.warn(`[Webhook payment] FALLBACK MISMATCH: extRef=${extRef} resolveu candidate.external_id=${candidate.external_id} mas webhook trouxe externalId=${externalId}. Rejeitando — possível cross-tenant poisoning attempt.`)
          try {
            await prisma.webhookLog.create({
              data: {
                company_id: candidate.company_id,
                event: event!,
                asaas_event_id: asaasEventId,
                payload: parsedBody,
                status: 'IGNORED',
                error: `Fallback mismatch: external_id ${candidate.external_id} != ${externalId}`,
              },
            })
          } catch {}
          return NextResponse.json({ ok: true, ignored: 'fallback_mismatch' })
        }
      }
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

  // 4. Create WebhookLog (legacy — preservado pra compat/observabilidade)
  let webhookLogId: string | null = null
  try {
    const log = await prisma.webhookLog.create({
      data: {
        company_id: payment.company_id,
        event: event!,
        payment_id: payment.id,
        asaas_event_id: asaasEventId,
        payload: parsedBody,
        status: 'RECEIVED',
      },
    })
    webhookLogId = log.id
  } catch { /* non-critical */ }

  // 4b. N9+N14 fix (audit pos-fix): WebhookEventLog INSERT/UPDATE agora
  // DENTRO da $transaction principal. Antes 2 webhooks idênticos podiam
  // ambos passar findUnique (não-existe), ambos chegavam no create — UM
  // disparava P2002 (200 dedup) MAS o OUTRO já tinha aberto sua transaction
  // e processado payment 2x. Agora P2002 aborta a tx inteira via ROLLBACK
  // — nada processa duplicado.
  let eventLogId: string | null = existingEventLogId

  // 5-7. Process INSIDE transaction for atomicity + idempotency
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 5a. Dedup INSERT/UPDATE primeiro DENTRO da tx
      if (asaasEventId) {
        if (existingEventLogId) {
          // Retry após FAILED/RECEIVED — atualiza pra reprocessamento
          await tx.webhookEventLog.update({
            where: { id: existingEventLogId },
            data: {
              status: 'RECEIVED',
              processing_started_at: new Date(),
              attempts: { increment: 1 },
              last_error: null,
            },
          })
        } else {
          // Tenta INSERT — UNIQUE(provider, event_id) garante atomicidade.
          // P2002 = outro request ganhou a race — ROLLBACK aborta tudo.
          const eventLog = await tx.webhookEventLog.create({
            data: {
              company_id: payment!.company_id,
              provider: 'ASAAS',
              event_id: asaasEventId,
              event_type: event!,
              status: 'RECEIVED',
              raw_payload: parsedBody,
              related_payment_id: payment!.id,
              processing_started_at: new Date(),
              ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
            },
          })
          eventLogId = eventLog.id
        }
      }

      // 5b. Re-read payment inside transaction for atomicity (prevents double-processing).
      // A11 fix: defense-in-depth com company_id.
      const fresh = await tx.payment.findFirst({
        where: { id: payment!.id, company_id: payment!.company_id },
      })
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

          // Audit 14 BUG 3 fix: criar Transaction + atualizar saldo da conta
          // bancária quando o webhook auto-baixa um pagamento. Antes:
          // accountReceivable virava RECEBIDO mas conta Asaas mostrava R$ 0,00
          // (extrato e fluxo-caixa não viam o crédito).
          //
          // Estratégia: usar receivable.account_id quando definido; senão
          // resolver via convenção "Asaas/PIX/Boleto" buscando primeira
          // Account ativa cujo bank_name match o billing_type.
          const billingType = (fresh.billing_type || fresh.method || '').toUpperCase()
          let creditAccountId: string | null = receivable.account_id || null
          if (!creditAccountId) {
            const inferred = await tx.account.findFirst({
              where: {
                company_id: fresh.company_id,
                is_active: true,
                OR: [
                  { name: { contains: 'asaas', mode: 'insensitive' } },
                  { bank_name: { contains: 'asaas', mode: 'insensitive' } },
                ],
              },
              select: { id: true },
            })
            creditAccountId = inferred?.id ?? null
          }
          if (creditAccountId) {
            await tx.transaction.create({
              data: {
                company_id: fresh.company_id,
                account_id: creditAccountId,
                transaction_type: 'CREDIT',
                amount: fresh.amount,
                description: `Recebimento Asaas (${billingType || 'PIX'}): ${receivable.description}`,
                bank_ref: asaasPayment.id,
                transaction_date: new Date(),
              },
            })
            await tx.account.update({
              where: { id: creditAccountId },
              data: {
                current_balance: { increment: fresh.amount },
                updated_at: new Date(),
              },
            })
          }

          // 2026-05-11 Fase 2 (cartao online + fix gap DRE): lancamento contabil
          // automatico no recebimento. Antes o webhook so atualizava saldo da
          // conta — DRE (via MV dre_monthly) nao enxergava nenhum recebimento
          // PIX/Boleto/Cartao. Agora cria FiscalEntry vinculado ao Payment.
          //
          // chart_account_id: usa primeira AccountChart REVENUE da empresa
          // (preferindo nome contendo "Servic" ou "Receita"). Se nao houver
          // plano de contas configurado, NAO bloqueia o webhook — apenas
          // loga warning. Gap silencioso vira gap explicito no log.
          try {
            const chartAccount = await tx.accountChart.findFirst({
              where: {
                company_id: fresh.company_id,
                is_active: true,
                account_type: 'REVENUE',
                OR: [
                  { name: { contains: 'Servic', mode: 'insensitive' } },
                  { name: { contains: 'Receita', mode: 'insensitive' } },
                ],
              },
              orderBy: { display_order: 'asc' },
              select: { id: true },
            })

            if (chartAccount) {
              await tx.fiscalEntry.create({
                data: {
                  company_id: fresh.company_id,
                  entry_date: new Date(),
                  cash_date: new Date(),
                  chart_account_id: chartAccount.id,
                  payment_id: fresh.id,
                  amount: BigInt(fresh.amount),
                  description: `Recebimento ${billingType || 'PIX'}: ${receivable.description}`,
                  source: 'PAYMENT',
                  is_provisional: false,
                  metadata: {
                    asaas_id: asaasPayment.id,
                    billing_type: billingType || null,
                    receivable_id: fresh.receivable_id,
                  },
                },
              })
            } else {
              console.warn(`[Webhook FiscalEntry] Empresa ${fresh.company_id} sem AccountChart REVENUE configurado — recebimento ${asaasPayment.id} NAO foi lancado no DRE. Configure plano de contas.`)
            }
          } catch (fiscalErr) {
            // Falha no FiscalEntry NAO deve quebrar a transacao da auto-baixa.
            // Log + segue — operacao manual de ajuste DRE pode ser feita depois.
            console.error('[Webhook FiscalEntry] Falha ao criar lancamento DRE:', fiscalErr instanceof Error ? fiscalErr.message : fiscalErr)
          }

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

          // 2026-05-11 Fase 2: criar FiscalEntry de estorno (amount negativo)
          // pra DRE refletir o refund. Sem isso, a venda fica computada como
          // receita mesmo apos estorno.
          try {
            const refundChartAccount = await tx.accountChart.findFirst({
              where: {
                company_id: fresh.company_id,
                is_active: true,
                account_type: 'REVENUE',
                OR: [
                  { name: { contains: 'Servic', mode: 'insensitive' } },
                  { name: { contains: 'Receita', mode: 'insensitive' } },
                ],
              },
              orderBy: { display_order: 'asc' },
              select: { id: true },
            })
            if (refundChartAccount) {
              await tx.fiscalEntry.create({
                data: {
                  company_id: fresh.company_id,
                  entry_date: new Date(),
                  cash_date: new Date(),
                  chart_account_id: refundChartAccount.id,
                  payment_id: fresh.id,
                  amount: BigInt(-fresh.amount),
                  description: `ESTORNO ${fresh.billing_type || fresh.method || 'PIX'}: ${receivable.description}`,
                  source: 'PAYMENT',
                  is_provisional: false,
                  metadata: {
                    asaas_id: asaasPayment.id,
                    billing_type: fresh.billing_type || null,
                    receivable_id: fresh.receivable_id,
                    refund: true,
                  },
                },
              })
            }
          } catch (refundFiscalErr) {
            console.error('[Webhook FiscalEntry Refund] Falha ao lancar estorno DRE:', refundFiscalErr instanceof Error ? refundFiscalErr.message : refundFiscalErr)
          }
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

    // C6: marcar WebhookEventLog com resultado final
    if (eventLogId) {
      const eventStatus = result.action === 'processed' ? 'PROCESSED'
        : result.action === 'conflict' ? 'FAILED'
        : 'IGNORED'
      try {
        await prisma.webhookEventLog.update({
          where: { id: eventLogId },
          data: {
            status: eventStatus,
            processing_finished_at: new Date(),
            last_error: result.action !== 'processed' ? result.reason : null,
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
            // B1 fix (audit): escapeHtml em todos os fields do user-controlled
            // input (legal_name, equipment) + URLs (ml.url). XSS sandbox em
            // clients de email modernos mitiga, mas é dívida higiênica.
            const { escapeHtml } = await import('@/lib/escape-html')
            const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f5;padding:20px;">
              <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
                <div style="background:#059669;padding:24px 32px;color:#fff;">
                  <h1 style="margin:0;font-size:20px;">${escapeHtml(companyName)}</h1>
                  <p style="margin:4px 0 0;font-size:14px;">Pagamento confirmado — OS #${escapeHtml(osNum)}</p>
                </div>
                <div style="padding:32px;">
                  <p>Ola, <strong>${escapeHtml(customer.legal_name || 'Cliente')}</strong>!</p>
                  <p>Confirmamos o recebimento do seu pagamento. Obrigado pela confianca!</p>
                  <table width="100%" cellpadding="8" style="background:#f9fafb;border-radius:6px;margin:16px 0;">
                    <tr><td>Valor</td><td style="text-align:right;font-weight:bold;">${escapeHtml(valorBRL)}</td></tr>
                    <tr><td>Forma</td><td style="text-align:right;">${escapeHtml(metodo)}</td></tr>
                    <tr><td>OS</td><td style="text-align:right;">#${escapeHtml(osNum)}</td></tr>
                    <tr><td>Equipamento</td><td style="text-align:right;">${escapeHtml(equipment)}</td></tr>
                  </table>
                  <a href="${escapeHtml(ml.url)}" style="display:block;text-align:center;background:#2563eb;color:#fff;padding:14px;border-radius:6px;text-decoration:none;font-weight:bold;">Acompanhar OS no portal</a>
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
  } catch (err: any) {
    // N9+N14: P2002 dentro da $transaction = race won by another request.
    // Tx aborta via ROLLBACK (nada processado), retorna 200 dedup.
    if (err?.code === 'P2002') {
      console.log('[Webhook] Race detected, aborted via ROLLBACK — dedup OK')
      return NextResponse.json({ ok: true, dedup: true, race: true })
    }
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

    // C6: marca WebhookEventLog como FAILED — retry do Asaas pode reprocessar
    if (eventLogId) {
      try {
        await prisma.webhookEventLog.update({
          where: { id: eventLogId },
          data: {
            status: 'FAILED',
            processing_finished_at: new Date(),
            last_error: err instanceof Error ? err.message.slice(0, 500) : 'Transaction failed',
          },
        })
      } catch { /* non-critical */ }
    }

    // Return 500 so Asaas retries (up to 3x)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
