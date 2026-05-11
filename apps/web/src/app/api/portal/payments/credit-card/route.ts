import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { getPaymentProviderForAccount } from '@/lib/payments/factory'
import { resolveDefaultProviderAccount } from '@/lib/payments/resolve-account'
import { canCustomerPayOS, PAYMENT_BLOCKED_MESSAGE } from '@/lib/os-payment-rules'
import { findActivePendingPaymentForOs } from '@/lib/payments/find-active-charge'

/**
 * POST /api/portal/payments/credit-card
 * Body: { service_order_id: string }
 *
 * Gera cobranca cartao de credito (checkout hospedado Asaas) pra cliente
 * pagar OS pelo portal antes da retirada/entrega. Cliente abre invoice_url,
 * preenche dados do cartao no dominio Asaas (PCI-DSS deles), Asaas processa
 * e envia webhook PAYMENT_CONFIRMED → PAYMENT_RECEIVED.
 *
 * FASE 1 (2026-05-11): APENAS A VISTA (1x). Parcelado 2-3x sera adicionado
 * em sprint separada quando webhook estiver preparado pra resolver parcelas
 * filhas via parent_payment_id.
 *
 * Mesma regra de visibilidade do PIX/Boleto: canCustomerPayOS retorna true
 * apenas pra status "Entregar Reparado" ou "Entregue". Em outros status,
 * pagamento antecipado online nao e permitido pela politica do Karlao.
 */
export async function POST(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

    const { service_order_id } = await req.json().catch(() => ({}))
    if (!service_order_id) return NextResponse.json({ error: 'service_order_id obrigatorio' }, { status: 400 })

    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: service_order_id,
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
      return NextResponse.json({ error: 'Cadastro sem CPF/CNPJ — complete o cadastro' }, { status: 400 })
    }

    if (!canCustomerPayOS(os.module_statuses?.name)) {
      return NextResponse.json({ error: PAYMENT_BLOCKED_MESSAGE }, { status: 422 })
    }

    // 2026-05-11: regra "1 OS = 1 Payment PENDING max". Bloqueia geracao se
    // ja ha cobranca ativa em PIX ou Boleto. Mesmo metodo CREDIT_CARD eh
    // reusado abaixo via findFirst.
    const activeCharge = await findActivePendingPaymentForOs(os.id, portalUser.company_id)
    if (activeCharge && !activeCharge.expired && activeCharge.payment.billing_type && activeCharge.payment.billing_type !== 'CREDIT_CARD') {
      return NextResponse.json({
        error: `Voce ja tem cobranca ${activeCharge.payment.billing_type} ativa pra essa OS. Pague pelo link enviado ou aguarde a expiracao pra gerar outra forma.`,
        reason: 'active_charge_other_method',
        active_payment: {
          id: activeCharge.payment.id,
          billing_type: activeCharge.payment.billing_type,
          invoice_url: activeCharge.payment.invoice_url,
        },
      }, { status: 409 })
    }

    const resolved = await resolveDefaultProviderAccount(portalUser.company_id)
    if (!resolved) {
      return NextResponse.json({ error: 'Empresa sem conta de pagamento configurada' }, { status: 503 })
    }

    // AR: busca ou cria pendente
    let receivable = await prisma.accountReceivable.findFirst({
      where: {
        service_order_id: os.id,
        company_id: portalUser.company_id,
        status: { in: ['PENDENTE', 'PARCIAL'] },
        deleted_at: null,
      },
      orderBy: { created_at: 'desc' },
    })

    if (!receivable) {
      const cat = await prisma.category.findFirst({
        where: {
          company_id: portalUser.company_id,
          module: 'financeiro_receita',
          name: { mode: 'insensitive', contains: 'Venda de Servi' },
        },
        select: { id: true },
      }).catch(() => null)

      receivable = await prisma.accountReceivable.create({
        data: {
          company_id: portalUser.company_id,
          customer_id: portalUser.customer_id,
          service_order_id: os.id,
          account_id: resolved.accountId,
          category_id: cat?.id || null,
          description: `Cobranca OS #${os.os_number} (cartao via portal)`,
          total_amount: os.total_cost,
          received_amount: 0,
          due_date: new Date(),
          status: 'PENDENTE',
          payment_method: 'CREDIT_CARD',
          notes: 'Cliente gerou cobranca cartao via portal',
        },
      })
    }

    const remaining = receivable.total_amount - (receivable.received_amount || 0)
    if (remaining <= 0) return NextResponse.json({ error: 'Esta OS ja foi paga' }, { status: 400 })

    // Idempotency: cartao ativo ja existe?
    const existing = await prisma.payment.findFirst({
      where: {
        receivable_id: receivable.id,
        method: 'CREDIT_CARD',
        status: 'PENDING',
      },
      orderBy: { created_at: 'desc' },
    })
    if (existing) {
      return NextResponse.json({
        data: {
          id: existing.id,
          receivable_id: receivable.id,
          invoice_url: existing.invoice_url,
          amount: existing.amount,
          status: existing.status,
        },
      })
    }

    const provider = await getPaymentProviderForAccount(resolved.accountId, portalUser.company_id)
    if (!provider) return NextResponse.json({ error: 'Provider indisponivel' }, { status: 503 })

    const idempotencyKey = `portal_cc_${receivable.id}_${Date.now()}`
    // FASE 1: a vista (sem installmentCount). Asaas processa como 1x.
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 1)

    const charge = await provider.createCharge({
      billingType: 'CREDIT_CARD',
      amount: remaining,
      customerName: os.customers.legal_name,
      customerDocument: os.customers.document_number,
      customerEmail: os.customers.email || undefined,
      customerPhone: os.customers.mobile || os.customers.phone || undefined,
      description: `OS #${os.os_number} - ${os.companies?.name || 'PontualERP'}`,
      dueDate: dueDate.toISOString().split('T')[0],
    })

    const payment = await prisma.payment.create({
      data: {
        company_id: portalUser.company_id,
        service_order_id: os.id,
        customer_id: portalUser.customer_id,
        receivable_id: receivable.id,
        provider: provider.name,
        external_id: charge.externalId,
        idempotency_key: idempotencyKey,
        amount: remaining,
        status: 'PENDING',
        method: 'CREDIT_CARD',
        billing_type: 'CREDIT_CARD',
        invoice_url: charge.invoiceUrl,
        metadata: { source: 'portal', account_id: resolved.accountId, installments: 1 },
      },
    })

    await prisma.accountReceivable.update({
      where: { id: receivable.id },
      data: {
        charge_id: payment.id,
        charge_status: 'PENDING',
        charge_url: charge.invoiceUrl,
        account_id: resolved.accountId,
        payment_method: 'CREDIT_CARD',
      },
    })

    return NextResponse.json({
      data: {
        id: payment.id,
        receivable_id: receivable.id,
        invoice_url: charge.invoiceUrl,
        amount: payment.amount,
        status: payment.status,
      },
    })
  } catch (err) {
    console.error('[Portal Credit Card Create Error]', err)
    const msg = err instanceof Error ? err.message : 'Erro ao gerar cobranca cartao'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
