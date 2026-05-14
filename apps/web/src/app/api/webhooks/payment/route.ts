import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPaymentProvider } from '@/lib/payments/factory'
import { captureFeesForPayment } from '@/lib/payments/capture-fees'

// Valid status transitions — reject anything not in this map
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'RECEIVED', 'OVERDUE', 'DELETED', 'FAILED', 'CANCELLED'],
  OVERDUE: ['CONFIRMED', 'RECEIVED', 'DELETED', 'CANCELLED'],
  // 2026-05-11 (chargeback): CONFIRMED/RECEIVED podem ir pra DISPUTED quando
  // cliente contesta cartao no banco. Asaas envia PAYMENT_CHARGEBACK_REQUESTED.
  // 2026-05-11 (V5 bug 5): REFUND_PENDING aceito a partir de CONFIRMED/RECEIVED.
  // Asaas envia PAYMENT_REFUND_IN_PROGRESS quando cliente pede refund e ele
  // ainda esta sendo processado pelo gateway — vira REFUND_PENDING local,
  // depois PAYMENT_REFUNDED finaliza. Antes RECEIVED -> REFUND_PENDING era
  // 'Invalid transition' e webhook pulava.
  CONFIRMED: ['RECEIVED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED', 'REFUND_PENDING'],
  RECEIVED: ['REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED', 'REFUND_PENDING'],
  // DISPUTED pode resolver pra (a) RECEIVED (comerciante ganhou disputa) ou
  // (b) REFUNDED via AWAITING_CHARGEBACK_REVERSAL (cliente ganhou, Asaas
  // estorna). REFUND_PENDING e estado transicional do Asaas refund.
  // 2026-05-11: DISPUTED -> DISPUTED aceito pra permitir multiplos eventos
  // chargeback consecutivos (REQUESTED + DISPUTE + AWAITING_REVERSAL) sem
  // bloquear no transition check. Cada evento diferencia comportamento via
  // event name no handler (isReversal).
  DISPUTED: ['DISPUTED', 'RECEIVED', 'REFUNDED', 'REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
  // 2026-05-11 (reteste V3): PARTIALLY_REFUNDED pode transitar pra REFUNDED
  // (refund completo apos parcial), DISPUTED (cliente disputa o restante),
  // ou REFUND_PENDING (asaas processando outro refund). Antes era source sem
  // transicoes — qualquer evento subsequente caia em "Invalid transition".
  PARTIALLY_REFUNDED: ['REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED', 'REFUND_PENDING'],
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

// 2026-05-11: lookup billing-aware pra FiscalEntry. Prioriza categoria
// especifica "Receita Servicos - PIX/Boleto/Cartao Credito" (seedadas
// 1.1.05/06/07 pra PontualTech + Imprimitech). Se nao achar, cai pra
// primeira REVENUE generica (compat antiga). Diferencia DRE por metodo
// de pagamento — antes todos PIX/Boleto/Cartao caiam na mesma "Receita
// de Servicos" e relatorio nao mostrava split.
async function resolveRevenueChart(
  tx: any,
  companyId: string,
  billingType: string | null,
): Promise<{ id: string } | null> {
  const map: Record<string, string> = {
    PIX: 'PIX',
    BOLETO: 'Boleto',
    CREDIT_CARD: 'Cartao Credito',
  }
  const label = billingType ? map[billingType.toUpperCase()] : null
  if (label) {
    const specific = await tx.accountChart.findFirst({
      where: {
        company_id: companyId,
        is_active: true,
        account_type: 'REVENUE',
        name: { contains: label, mode: 'insensitive' },
      },
      select: { id: true },
    })
    if (specific) return specific
  }
  return tx.accountChart.findFirst({
    where: {
      company_id: companyId,
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
}

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

      // Idempotency: already at this status — exceto pra AWAITING_CHARGEBACK_REVERSAL
      // que tem comportamento DISTINTO de REQUESTED/DISPUTE apesar de mapear pra
      // mesmo Payment.status=DISPUTED (REVERSAL reverte AR/saldo/DRE; REQUESTED só
      // marca). Reteste V2 detectou: AWAITING_REVERSAL chegando apos REQUESTED ficava
      // bloqueado aqui e handler de reversao nunca rodava.
      const isReversalEvent = event === 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
      if (fresh.status === newStatus && !isReversalEvent) {
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

      // RECEIVED: dinheiro DISPONIVEL na conta — sempre cria Transaction +
      // FiscalEntry (regime caixa). Baixa o AR se ainda nao baixado (caso
      // PIX direto sem CONFIRMED) ou apenas atualiza charge_status se ja
      // baixou pelo CONFIRMED (cartao/boleto fluxo padrao).
      if (newStatus === AUTO_BAIXA_STATUS && fresh.receivable_id) {
        const receivable = await tx.accountReceivable.findFirst({
          where: { id: fresh.receivable_id, company_id: fresh.company_id },
        })

        if (receivable) {
          // 2026-05-11: idempotencia AR baixa — so baixa se ainda PENDENTE.
          // Se CONFIRMED ja baixou antes, RECEIVED nao baixa de novo (evita
          // double credit). Mas Transaction + FiscalEntry SEMPRE rodam aqui
          // porque sao do regime caixa (so quando dinheiro REALMENTE entra).
          if (receivable.status !== 'RECEBIDO') {
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
          } else {
            // AR ja RECEBIDO (CONFIRMED veio antes). So atualiza charge_status.
            await tx.accountReceivable.update({
              where: { id: fresh.receivable_id },
              data: { charge_status: newStatus, updated_at: new Date() },
            })
          }

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
            // 2026-05-11 (V4 bug 4): idempotência por bank_ref. Antes, se Asaas
            // mandasse RECEIVED depois de DISPUTED → RECEIVED (comerciante ganha
            // chargeback), o handler criava Transaction CREDIT de novo —
            // duplicava o crédito e inflava saldo. Agora checa se já existe
            // Transaction CREDIT com mesmo bank_ref antes de criar.
            const existingCredit = await tx.transaction.findFirst({
              where: {
                company_id: fresh.company_id,
                bank_ref: asaasPayment.id,
                transaction_type: 'CREDIT',
              },
              select: { id: true },
            })
            if (!existingCredit) {
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
            const chartAccount = await resolveRevenueChart(tx, fresh.company_id, billingType)

            // 2026-05-11 (V4 bug 4): idempotência FiscalEntry positivo. Mesmo
            // problema do Transaction acima — RECEIVED após DISPUTED criava
            // FE duplicado. Checa se já existe FE com payment_id + amount
            // positivo antes de criar.
            const existingPositive = chartAccount ? await tx.fiscalEntry.findFirst({
              where: {
                company_id: fresh.company_id,
                payment_id: fresh.id,
                amount: { gt: 0 },
              },
              select: { id: true },
            }) : null

            if (!chartAccount) {
              console.warn(`[Webhook FiscalEntry] Empresa ${fresh.company_id} sem AccountChart REVENUE configurado — recebimento ${asaasPayment.id} NAO foi lancado no DRE. Configure plano de contas.`)
            } else if (!existingPositive) {
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
            }
            // else: FE positivo ja existe — idempotente, no-op silencioso
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

      // 2026-05-11 (Karlao OS 60475): CONFIRMED tambem BAIXA o AR.
      // Antes so atualizava charge_status — AR ficava PENDENTE eternamente
      // pra cartao (que liquida CONFIRMED no dia 0 mas dinheiro so cai no
      // RECEIVED D+30). Operacionalmente cliente quitou a divida no dia 0,
      // entao AR=RECEBIDO. Transaction (extrato) + FiscalEntry (DRE) NAO
      // sao criados aqui — continuam exclusivos do RECEIVED quando dinheiro
      // de fato esta na conta (regime caixa, evita inflar saldo banco).
      //
      // PIX nao passa por esse handler porque Asaas envia direto PAYMENT_RECEIVED
      // (pulando CONFIRMED). Boleto pode passar (CONFIRMED quando compensa
      // + RECEIVED quando dinheiro vira disponivel). Cartao sempre passa.
      if (newStatus === 'CONFIRMED' && fresh.receivable_id) {
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
              charge_status: 'CONFIRMED',
              payment_method: fresh.billing_type || fresh.method || receivable.payment_method,
              updated_at: new Date(),
            },
          })

          // Append nota interna na OS pra atendente ver pagamento confirmado
          // mesmo antes do dinheiro cair na conta
          if (fresh.service_order_id) {
            const so = await tx.serviceOrder.findUnique({
              where: { id: fresh.service_order_id },
              select: { internal_notes: true },
            })
            const valorBRL = (fresh.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            const dataStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
            const metodo = fresh.billing_type || fresh.method || 'PIX'
            const novaNota = `[${dataStr}] ✓ Pagamento confirmado (autorizado): ${metodo} ${valorBRL} — Asaas ${asaasPayment.id} (extrato/DRE atualizam no RECEIVED)`
            const notesAtual = so?.internal_notes ? so.internal_notes + '\n' : ''
            await tx.serviceOrder.update({
              where: { id: fresh.service_order_id },
              data: { internal_notes: notesAtual + novaNota },
            })
          }
        } else if (receivable) {
          // AR ja RECEBIDO (caso raro: CONFIRMED chegou DEPOIS de RECEIVED).
          // So atualiza charge_status pra refletir estado mais recente.
          await tx.accountReceivable.update({
            where: { id: fresh.receivable_id },
            data: { charge_status: 'CONFIRMED', updated_at: new Date() },
          })
        }
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

      // Handle REFUNDED: reverte AR + cria Transaction DEBIT + decrementa
      // saldo conta + FiscalEntry estorno. Estorno completo afeta 3 modelos:
      //   1. AccountReceivable (received_amount reduzido + status revertido)
      //   2. Transaction DEBIT + Account.current_balance decremento (extrato)
      //   3. FiscalEntry negativo (DRE)
      //
      // 2026-05-11 (teste profundo Karlao): antes faltava (2) — refund deixava
      // saldo da conta inflado e extrato sem registro do debito. Gap impactava
      // chargebacks de cartao (que sao mais comuns que refunds manuais).
      if (newStatus === 'REFUNDED' && fresh.receivable_id) {
        const receivable = await tx.accountReceivable.findFirst({
          where: { id: fresh.receivable_id, company_id: fresh.company_id },
        })

        if (receivable) {
          // 1. AR: reverter received_amount + ajustar status
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

          // 2. Transaction DEBIT + decrementa current_balance (mesma logica
          // do RECEIVED handler mas invertida). Idempotente: se ja existe
          // Transaction com bank_ref deste refund, nao cria de novo.
          const billingType = (fresh.billing_type || fresh.method || '').toUpperCase()
          let debitAccountId: string | null = receivable.account_id || null
          if (!debitAccountId) {
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
            debitAccountId = inferred?.id ?? null
          }
          if (debitAccountId) {
            // 2026-05-11 (chargeback): se AWAITING_CHARGEBACK_REVERSAL ja debitou
            // (bank_ref `<id>-chargeback`), REFUNDED nao deve duplicar. Checa
            // ambos suffixes.
            const refundBankRef = `${asaasPayment.id}-refund`
            const chargebackBankRef = `${asaasPayment.id}-chargeback`
            const existingDebit = await tx.transaction.findFirst({
              where: {
                company_id: fresh.company_id,
                bank_ref: { in: [refundBankRef, chargebackBankRef] },
              },
              select: { id: true },
            })
            if (!existingDebit) {
              await tx.transaction.create({
                data: {
                  company_id: fresh.company_id,
                  account_id: debitAccountId,
                  transaction_type: 'DEBIT',
                  amount: fresh.amount,
                  description: `Estorno Asaas (${billingType || 'PIX'}): ${receivable.description}`,
                  bank_ref: refundBankRef,
                  transaction_date: new Date(),
                },
              })
              await tx.account.update({
                where: { id: debitAccountId },
                data: {
                  current_balance: { decrement: fresh.amount },
                  updated_at: new Date(),
                },
              })
            }
          }

          // 3. FiscalEntry estorno (amount negativo) pra DRE refletir refund.
          // Usa MESMA categoria do recebimento (billing-aware) pra estorno
          // bater na linha certa da DRE.
          try {
            const refundChartAccount = await resolveRevenueChart(tx, fresh.company_id, fresh.billing_type || fresh.method)
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

      // 2026-05-11 (chargeback): Handle DISPUTED — cliente contestou cartao.
      // Asaas envia 3 eventos distintos, todos mapeados pra DISPUTED:
      //   PAYMENT_CHARGEBACK_REQUESTED  -> abertura disputa (sem mexer em $)
      //   PAYMENT_CHARGEBACK_DISPUTE    -> em analise (sem mexer)
      //   PAYMENT_AWAITING_CHARGEBACK_REVERSAL -> Asaas vai reverter (perdemos)
      //
      // Estrategia conservadora: REQUESTED/DISPUTE so marcam AR + abrem
      // ticket pra atendente avaliar. AWAITING_REVERSAL reverte como refund
      // (Transaction DEBIT + decremento saldo + FE negativo).
      //
      // Se eventualmente PAYMENT_REFUNDED chegar depois (Asaas formaliza o
      // estorno), o handler REFUNDED ja vai detectar bank_ref existente e
      // nao duplicar — idempotencia via WebhookEventLog + bank_ref check.
      if (newStatus === 'DISPUTED' && fresh.receivable_id) {
        const isReversal = event === 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
        const receivable = await tx.accountReceivable.findFirst({
          where: { id: fresh.receivable_id, company_id: fresh.company_id },
        })

        if (receivable) {
          if (isReversal) {
            // Trata como refund: reverte AR + Transaction DEBIT + decremento + FE neg
            const newReceived = Math.max(0, (receivable.received_amount || 0) - fresh.amount)
            await tx.accountReceivable.update({
              where: { id: fresh.receivable_id },
              data: {
                received_amount: newReceived,
                status: newReceived >= receivable.total_amount ? 'RECEBIDO' : 'PENDENTE',
                charge_status: 'CHARGEBACK_LOST',
                updated_at: new Date(),
              },
            })

            // Transaction DEBIT (mesma logica do REFUNDED handler)
            const billingType = (fresh.billing_type || fresh.method || '').toUpperCase()
            let debitAccountId: string | null = receivable.account_id || null
            if (!debitAccountId) {
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
              debitAccountId = inferred?.id ?? null
            }
            if (debitAccountId) {
              const refundBankRef = `${asaasPayment.id}-chargeback`
              const existingDebit = await tx.transaction.findFirst({
                where: { company_id: fresh.company_id, bank_ref: refundBankRef },
                select: { id: true },
              })
              if (!existingDebit) {
                await tx.transaction.create({
                  data: {
                    company_id: fresh.company_id,
                    account_id: debitAccountId,
                    transaction_type: 'DEBIT',
                    amount: fresh.amount,
                    description: `Chargeback Asaas (${billingType || 'CREDIT_CARD'}): ${receivable.description}`,
                    bank_ref: refundBankRef,
                    transaction_date: new Date(),
                  },
                })
                await tx.account.update({
                  where: { id: debitAccountId },
                  data: {
                    current_balance: { decrement: fresh.amount },
                    updated_at: new Date(),
                  },
                })
              }
            }

            // FiscalEntry estorno por chargeback (mesma categoria do
            // recebimento via resolveRevenueChart billing-aware)
            try {
              const cbChartAccount = await resolveRevenueChart(tx, fresh.company_id, fresh.billing_type || fresh.method)
              if (cbChartAccount) {
                await tx.fiscalEntry.create({
                  data: {
                    company_id: fresh.company_id,
                    entry_date: new Date(),
                    cash_date: new Date(),
                    chart_account_id: cbChartAccount.id,
                    payment_id: fresh.id,
                    amount: BigInt(-fresh.amount),
                    description: `CHARGEBACK ${fresh.billing_type || 'CREDIT_CARD'}: ${receivable.description}`,
                    source: 'PAYMENT',
                    is_provisional: false,
                    metadata: {
                      asaas_id: asaasPayment.id,
                      billing_type: fresh.billing_type || null,
                      receivable_id: fresh.receivable_id,
                      chargeback: true,
                    },
                  },
                })
              }
            } catch (cbErr) {
              console.error('[Webhook FiscalEntry Chargeback] Falha:', cbErr instanceof Error ? cbErr.message : cbErr)
            }
          } else {
            // REQUESTED ou DISPUTE: so marca AR.charge_status — sem mexer $
            await tx.accountReceivable.update({
              where: { id: fresh.receivable_id },
              data: { charge_status: 'DISPUTED', updated_at: new Date() },
            })
          }

          // Nota interna na OS pra atendente ver
          if (fresh.service_order_id) {
            const so = await tx.serviceOrder.findUnique({
              where: { id: fresh.service_order_id },
              select: { internal_notes: true },
            })
            const valorBRL = (fresh.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            const dataStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
            const eventLabel = isReversal ? 'ESTORNADO pelo Asaas' : 'EM DISPUTA'
            const novaNota = `[${dataStr}] ⚠️ Chargeback ${eventLabel}: ${fresh.billing_type || 'CREDIT_CARD'} ${valorBRL} — Asaas ${asaasPayment.id}`
            const notesAtual = so?.internal_notes ? so.internal_notes + '\n' : ''
            await tx.serviceOrder.update({
              where: { id: fresh.service_order_id },
              data: { internal_notes: notesAtual + novaNota },
            })
          }

          // 2026-05-11: Ticket priority HIGH automatico pra atendente avaliar
          // chargeback e contestar dentro do prazo Asaas (geralmente 7-14d).
          // Idempotente: checa se ja existe ticket category=CHARGEBACK pra essa
          // OS antes de criar (evita duplicacao se REQUESTED + DISPUTE vierem
          // em sequencia).
          try {
            const existingTicket = await tx.ticket.findFirst({
              where: {
                company_id: fresh.company_id,
                service_order_id: fresh.service_order_id,
                category: { in: ['CHARGEBACK', 'CHARGEBACK_LOST'] },
                deleted_at: null,
              },
              select: { id: true, category: true },
            })

            const valorBRL = (fresh.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            const category = isReversal ? 'CHARGEBACK_LOST' : 'CHARGEBACK'
            const subject = isReversal
              ? `⚠️ Chargeback PERDIDO — OS ${fresh.service_order_id ? '' : ''}Asaas ${asaasPayment.id} (${valorBRL})`
              : `🛡️ Chargeback ABERTO — contestar com Asaas (${valorBRL})`
            const description = isReversal
              ? `Asaas reverteu o pagamento. Receita ${valorBRL} estornada do AR + saldo + DRE. Verificar se cabe reabrir disputa ou recuperar valor por outro meio.`
              : `Cliente abriu disputa no banco contra cobranca ${fresh.billing_type || 'CREDIT_CARD'} ${valorBRL} (Asaas ${asaasPayment.id}). Atendente deve verificar painel Asaas e enviar contestacao DENTRO DO PRAZO (geralmente 7-14 dias). Se perdermos, saldo + DRE sao revertidos automaticamente pelo webhook.`

            if (!existingTicket) {
              const last = await tx.ticket.findFirst({
                where: { company_id: fresh.company_id },
                orderBy: { ticket_number: 'desc' },
                select: { ticket_number: true },
              })
              await tx.ticket.create({
                data: {
                  company_id: fresh.company_id,
                  ticket_number: (last?.ticket_number || 0) + 1,
                  subject,
                  description,
                  status: 'ABERTO',
                  priority: 'HIGH',
                  category,
                  source: 'WEBHOOK',
                  customer_id: fresh.customer_id,
                  service_order_id: fresh.service_order_id || null,
                  created_by: 'system:webhook',
                  created_by_type: 'SISTEMA',
                },
              })
            } else if (isReversal && existingTicket.category === 'CHARGEBACK') {
              // Atualiza ticket existente: REQUESTED virou REVERSAL (perdemos)
              await tx.ticket.update({
                where: { id: existingTicket.id },
                data: {
                  category: 'CHARGEBACK_LOST',
                  subject,
                  description,
                  updated_at: new Date(),
                },
              })
              await tx.ticketMessage.create({
                data: {
                  company_id: fresh.company_id,
                  ticket_id: existingTicket.id,
                  message: `Atualizacao automatica: Asaas confirmou estorno via AWAITING_CHARGEBACK_REVERSAL. Saldo + DRE ja ajustados.`,
                  sender_type: 'SISTEMA',
                  sender_name: 'Sistema (Webhook Asaas)',
                  is_internal: true,
                },
              })
            }
          } catch (ticketErr) {
            // Falha de ticket NAO bloqueia outras acoes (AR ja foi atualizado).
            // Loga + segue — operador pode criar manualmente.
            console.error('[Webhook Chargeback Ticket] Falha:', ticketErr instanceof Error ? ticketErr.message : ticketErr)
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

    // Feature 2026-05-14 (feat 4/4): aviso pro sino do dashboard quando
    // cobranca vira RECEIVED. Atendente ve em ate ~10s (poll do useAvisos).
    // Fire-and-forget — falha aqui nao reverte a baixa.
    if (result.action === 'processed' && result.reason && /→ RECEIVED$/.test(result.reason) && payment.receivable_id) {
      ;(async () => {
        try {
          // Audit fix 2026-05-14 #1: dedup. Re-fetch payment pra valor fresco
          // (fix #5) + busca AR com totals atualizados.
          const freshPay = await prisma.payment.findUnique({
            where: { id: payment.id },
            select: { amount: true, external_id: true, company_id: true, receivable_id: true },
          })
          if (!freshPay || !freshPay.receivable_id) return
          const ar = await prisma.accountReceivable.findUnique({
            where: { id: freshPay.receivable_id },
            select: {
              total_amount: true,
              service_orders: { select: { os_number: true } },
              customers: { select: { legal_name: true } },
            },
          })
          if (!ar) return

          // Dedup: se ja existe Announcement deste payment.external_id, skip.
          // Asaas pode reenviar webhook (retry 3x oficial) ou disparar 2
          // eventos distintos pra mesmo pagamento (DUNNING_RECEIVED + PAYMENT_RECEIVED).
          const existing = freshPay.external_id ? await prisma.announcement.findFirst({
            where: {
              company_id: freshPay.company_id,
              created_by: 'webhook-asaas',
              message: { contains: freshPay.external_id },
            },
            select: { id: true },
          }) : null
          if (existing) return

          const valorBRL = (freshPay.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          const osStr = ar.service_orders ? `OS #${ar.service_orders.os_number}` : 'cobrança'
          const customerName = ar.customers?.legal_name || 'Cliente'
          await prisma.announcement.create({
            data: {
              company_id: freshPay.company_id,
              title: `💰 Pagamento recebido — ${osStr} — ${customerName}`,
              // external_id na mensagem viabiliza dedup acima.
              message: `Cliente pagou ${valorBRL} via Asaas. Aguardando confirmacao bancaria pra fundos cairem na conta.${freshPay.external_id ? ` [ref:${freshPay.external_id}]` : ''}`,
              priority: 'IMPORTANTE',
              require_read: false,
              author_name: 'Sistema',
              created_by: 'webhook-asaas',
            },
          })
        } catch (e) {
          console.warn('[webhook-payment] erro criando announcement RECEIVED:', e instanceof Error ? e.message : e)
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
