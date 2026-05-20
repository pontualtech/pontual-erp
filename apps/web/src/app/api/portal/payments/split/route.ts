// POST /api/portal/payments/split — Fase C-light 2026-05-20
//
// Cliente paga OS dividindo o valor em multiplas formas (ex: 500 PIX + 200 cartao 2x).
// Cria N AccountsReceivable agrupados por group_id + N Payments Asaas (1 por forma).
// Retorna array de payments com QR codes / invoice URLs pra cliente pagar cada um.
//
// Cenario A escolhido por Karlao 2026-05-19: Asaas mantem 1 charge por forma
// (cliente recebe N links — cada webhook baixa SEU AR independentemente).
//
// Atomicidade limitada: se algum charge Asaas falha no meio, faz cleanup manual
// (soft-delete ARs criadas + cancela Payments ja registrados). Charges Asaas
// orfas expiram automaticamente (PIX 30min) ou ficam unpaid (boleto/cartao).
//
// Regra "1 OS = 1 Payment PENDING max" e relaxada quando group_id setado.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { getPaymentProviderForAccount } from '@/lib/payments/factory'
import { resolveDefaultProviderAccount } from '@/lib/payments/resolve-account'
import { canCustomerPayOS, PAYMENT_BLOCKED_MESSAGE } from '@/lib/os-payment-rules'
import { isOsAlreadyPaid, findActivePendingPaymentForOs } from '@/lib/payments/find-active-charge'
import { createReceivableOrSplit } from '@/lib/financeiro/receivables'
import { logAudit } from '@/lib/audit'

type BillingMethod = 'PIX' | 'BOLETO' | 'CREDIT_CARD'

interface SplitInput {
  payment_method: BillingMethod
  amount_cents: number
  installments?: number
}

// Minimos por forma (defesa server-side; frontend tambem valida)
const MIN_BY_METHOD: Record<BillingMethod, number> = {
  PIX: 100,         // R$ 1,00
  BOLETO: 500,      // R$ 5,00
  CREDIT_CARD: 500, // R$ 5,00
}

export async function POST(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const serviceOrderId: string | undefined = body.service_order_id
    const splitsInput: SplitInput[] | undefined = Array.isArray(body.splits) ? body.splits : undefined
    if (!serviceOrderId) return NextResponse.json({ error: 'service_order_id obrigatorio' }, { status: 400 })
    if (!splitsInput || splitsInput.length < 2) {
      return NextResponse.json({ error: 'splits[] com pelo menos 2 formas obrigatorio' }, { status: 400 })
    }

    // 1. Carrega OS + cliente + status
    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: serviceOrderId,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      include: {
        customers: { select: { id: true, legal_name: true, document_number: true, email: true, mobile: true, phone: true } },
        companies: { select: { name: true } },
        module_statuses: { select: { name: true } },
      },
    })
    if (!os) return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    if (!os.total_cost || os.total_cost <= 0) {
      return NextResponse.json({ error: 'OS sem valor definido' }, { status: 400 })
    }
    if (!os.customers?.document_number) {
      return NextResponse.json({ error: 'Cadastro sem CPF/CNPJ' }, { status: 400 })
    }

    // 2. Status atual permite pagamento?
    if (!canCustomerPayOS(os.module_statuses?.name)) {
      return NextResponse.json({ error: PAYMENT_BLOCKED_MESSAGE }, { status: 422 })
    }
    if (await isOsAlreadyPaid(os.id, portalUser.company_id)) {
      return NextResponse.json({ error: 'OS ja paga', reason: 'os_already_paid' }, { status: 409 })
    }

    // 3. Bloqueio se ja tem Payment PENDING sem group_id (cobranca simples ativa).
    // Quando group_id setado significa que foi um split anterior — permite criar outro
    // grupo apenas se cliente cancelar/expirar os anteriores. Pra simplificar Fase C-light,
    // bloqueia qualquer Payment ativo. Cliente precisa cancelar split anterior antes.
    const activeCharge = await findActivePendingPaymentForOs(os.id, portalUser.company_id)
    if (activeCharge && !activeCharge.expired) {
      return NextResponse.json({
        error: 'Voce ja tem cobranca ativa pra essa OS. Aguarde expirar ou pague pelo link enviado.',
        reason: 'active_charge_exists',
      }, { status: 409 })
    }

    // 4. Validacoes server-side
    let sumCents = 0
    for (const s of splitsInput) {
      if (!['PIX', 'BOLETO', 'CREDIT_CARD'].includes(s.payment_method)) {
        return NextResponse.json({ error: `Forma invalida: ${s.payment_method}` }, { status: 400 })
      }
      if (!Number.isFinite(s.amount_cents) || s.amount_cents <= 0) {
        return NextResponse.json({ error: 'amount_cents invalido em algum split' }, { status: 400 })
      }
      const min = MIN_BY_METHOD[s.payment_method]
      if (s.amount_cents < min) {
        return NextResponse.json({ error: `${s.payment_method} minimo R$ ${(min / 100).toFixed(2)}` }, { status: 400 })
      }
      if (s.payment_method === 'CREDIT_CARD' && s.installments && (s.installments < 1 || s.installments > 12)) {
        return NextResponse.json({ error: 'installments deve estar entre 1 e 12' }, { status: 400 })
      }
      sumCents += s.amount_cents
    }
    if (sumCents !== os.total_cost) {
      return NextResponse.json({
        error: `Soma dos splits (R$ ${(sumCents / 100).toFixed(2)}) deve ser igual ao total da OS (R$ ${((os.total_cost) / 100).toFixed(2)})`,
      }, { status: 400 })
    }

    // 5. Resolve conta bancaria com provider Asaas
    const resolved = await resolveDefaultProviderAccount(portalUser.company_id)
    if (!resolved) return NextResponse.json({ error: 'Empresa sem conta de pagamento configurada' }, { status: 503 })
    const provider = await getPaymentProviderForAccount(resolved.accountId, portalUser.company_id)
    if (!provider) return NextResponse.json({ error: 'Provider indisponivel' }, { status: 503 })

    // 6. Categoria padrao de receita
    const cat = await prisma.category.findFirst({
      where: { company_id: portalUser.company_id, module: 'financeiro_receita', name: { mode: 'insensitive', contains: 'Venda de Servi' } },
      select: { id: true },
    }).catch(() => null)

    // 7. Cria N ARs via lib compartilhada (com group_id UUID gerado automaticamente)
    const { receivables, groupId } = await createReceivableOrSplit({
      companyId: portalUser.company_id,
      customerId: portalUser.customer_id,
      serviceOrderId: os.id,
      description: `Cobranca OS #${os.os_number} (split portal cliente)`,
      dueDate: new Date(),
      categoryId: cat?.id || null,
      totalAmount: os.total_cost,
      status: 'PENDENTE',
      reconciled: false,
      splits: splitsInput.map(s => ({
        payment_method: s.payment_method,
        account_id: resolved.accountId,
        amount: s.amount_cents,
        installment_count: s.payment_method === 'CREDIT_CARD' ? (s.installments || 1) : 1,
      })),
    })

    // 8. Pra cada AR, cria 1 Payment Asaas correspondente.
    // Se falhar no meio, faz cleanup manual: soft-delete dos ARs + Payments criados.
    const createdPayments: any[] = []
    const cleanup = async (reason: string, errDetail?: string) => {
      // Soft-delete ARs
      await prisma.accountReceivable.updateMany({
        where: { id: { in: receivables.map(r => r.id) } },
        data: { deleted_at: new Date(), status: 'CANCELADO' },
      })
      // Marca Payments criados como CANCELLED (Asaas charges orfas expiram sozinhas)
      if (createdPayments.length > 0) {
        await prisma.payment.updateMany({
          where: { id: { in: createdPayments.map(p => p.id) } },
          data: { status: 'CANCELLED' },
        })
      }
      logAudit({
        companyId: portalUser.company_id,
        userId: `portal:${portalUser.customer_id}`,
        module: 'portal',
        action: 'payment_split_failed',
        entityId: os.id,
        newValue: {
          os_number: os.os_number,
          group_id: groupId,
          ars_created: receivables.length,
          payments_created: createdPayments.length,
          reason,
          error_detail: errDetail,
        },
      })
    }

    for (let i = 0; i < receivables.length; i++) {
      const ar = receivables[i]
      const split = splitsInput[i]
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + 1) // boleto/cartao vence amanha
      const idempotencyKey = `portal_split_${ar.id}`

      try {
        let charge: any
        const baseChargeParams = {
          amount: split.amount_cents,
          customerName: os.customers.legal_name,
          customerDocument: os.customers.document_number,
          customerEmail: os.customers.email || undefined,
          customerPhone: os.customers.mobile || os.customers.phone || undefined,
          description: `OS #${os.os_number} (${i + 1}/${receivables.length}) - ${os.companies?.name || 'PontualERP'}`,
        }

        if (split.payment_method === 'PIX') {
          charge = await provider.createPixCharge({
            ...baseChargeParams,
            idempotencyKey,
            expiresInMinutes: 60,
          })
        } else {
          charge = await provider.createCharge({
            ...baseChargeParams,
            billingType: split.payment_method,
            dueDate: dueDate.toISOString().split('T')[0],
            ...(split.payment_method === 'CREDIT_CARD' && split.installments && split.installments > 1
              ? { installmentCount: split.installments }
              : {}),
          })
        }

        const payment = await prisma.payment.create({
          data: {
            company_id: portalUser.company_id,
            service_order_id: os.id,
            customer_id: portalUser.customer_id,
            receivable_id: ar.id,
            provider: provider.name,
            external_id: charge.externalId,
            idempotency_key: idempotencyKey,
            amount: split.amount_cents,
            status: 'PENDING',
            method: split.payment_method,
            billing_type: split.payment_method,
            qr_code: charge.qrCode || null,
            qr_code_image: charge.qrCodeImage || null,
            invoice_url: charge.invoiceUrl || null,
            bank_slip_url: charge.bankSlipUrl || null,
            expires_at: charge.expiresAt || null,
            metadata: { source: 'portal_split', account_id: resolved.accountId, group_id: groupId, split_index: i + 1, split_total: receivables.length },
          },
        })
        createdPayments.push(payment)
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[portal/split] charge ${i + 1}/${receivables.length} falhou:`, msg)
        await cleanup('asaas_charge_failed', msg)
        return NextResponse.json({
          error: `Falha ao gerar cobranca ${split.payment_method} (parte ${i + 1}/${receivables.length}): ${msg}`,
          reason: 'asaas_charge_failed',
        }, { status: 502 })
      }
    }

    logAudit({
      companyId: portalUser.company_id,
      userId: `portal:${portalUser.customer_id}`,
      module: 'portal',
      action: 'payment_split_created',
      entityId: os.id,
      newValue: {
        os_number: os.os_number,
        group_id: groupId,
        splits_count: receivables.length,
        total: os.total_cost,
        methods: splitsInput.map(s => `${s.payment_method}:${s.amount_cents}`),
      },
    })

    return NextResponse.json({
      data: {
        group_id: groupId,
        os_number: os.os_number,
        total_amount: os.total_cost,
        payments: createdPayments.map((p, i) => ({
          id: p.id,
          receivable_id: p.receivable_id,
          method: p.method,
          amount: p.amount,
          status: p.status,
          qr_code: p.qr_code,
          qr_code_image: p.qr_code_image,
          invoice_url: p.invoice_url,
          bank_slip_url: p.bank_slip_url,
          expires_at: p.expires_at,
          installments: splitsInput[i].installments || 1,
          split_index: i + 1,
          split_total: createdPayments.length,
        })),
      },
    })
  } catch (err) {
    console.error('[portal/split] erro inesperado:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
