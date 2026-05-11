import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { getPaymentProviderForAccount } from '@/lib/payments/factory'
import { resolveDefaultProviderAccount } from '@/lib/payments/resolve-account'
import { canCustomerPayOS, PAYMENT_BLOCKED_MESSAGE } from '@/lib/os-payment-rules'
import { findActivePendingPaymentForOs, isOsAlreadyPaid } from '@/lib/payments/find-active-charge'

/**
 * POST /api/portal/payments/boleto
 * Body: { service_order_id: string, due_days?: number }
 *
 * Gera boleto Asaas pra cliente pagar OS pelo portal. Mesmo fluxo do
 * PIX (cria/reusa AR + Payment vinculado), so o billing_type muda.
 * due_days default 7, max 30.
 */
export async function POST(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

    const { service_order_id } = await req.json().catch(() => ({}))
    if (!service_order_id) return NextResponse.json({ error: 'service_order_id obrigatorio' }, { status: 400 })
    // Portal SEMPRE gera boleto a vista (vence hoje). Boleto com prazo
    // estendido so e emitido pelo atendente via /os/[id]/charge ou
    // /financeiro/cobranca. Assim clientes nao pegam 7 dias pra pagar
    // como 'atalho' do fluxo comercial.
    const dueDays = 1

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

    // Status atual permite pagamento? (so libera apos cliente aprovar reparo)
    if (!canCustomerPayOS(os.module_statuses?.name)) {
      return NextResponse.json({ error: PAYMENT_BLOCKED_MESSAGE }, { status: 422 })
    }

    // 2026-05-11 (Karlao OS 60475): bloqueia se OS ja paga
    if (await isOsAlreadyPaid(os.id, portalUser.company_id)) {
      return NextResponse.json({
        error: 'Esta OS ja foi paga. Acesse o portal pra ver o comprovante.',
        reason: 'os_already_paid',
      }, { status: 409 })
    }

    // 2026-05-11: regra "1 OS = 1 Payment PENDING max". Bloqueia geracao se
    // ja ha cobranca ativa em PIX ou Cartao. Mesmo metodo BOLETO eh reusado
    // abaixo via findFirst.
    const activeCharge = await findActivePendingPaymentForOs(os.id, portalUser.company_id)
    if (activeCharge && !activeCharge.expired && activeCharge.payment.billing_type && activeCharge.payment.billing_type !== 'BOLETO') {
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

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + dueDays)

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
          description: `Cobranca OS #${os.os_number} (boleto via portal)`,
          total_amount: os.total_cost,
          received_amount: 0,
          due_date: dueDate,
          status: 'PENDENTE',
          payment_method: 'BOLETO',
          notes: 'Cliente gerou boleto via portal',
        },
      })
    }

    const remaining = receivable.total_amount - (receivable.received_amount || 0)
    if (remaining <= 0) return NextResponse.json({ error: 'Esta OS ja foi paga' }, { status: 400 })

    // Idempotency: boleto ativo ja existe?
    const existing = await prisma.payment.findFirst({
      where: {
        receivable_id: receivable.id,
        method: 'BOLETO',
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
          bank_slip_url: existing.bank_slip_url,
          amount: existing.amount,
          status: existing.status,
        },
      })
    }

    const provider = await getPaymentProviderForAccount(resolved.accountId, portalUser.company_id)
    if (!provider) return NextResponse.json({ error: 'Provider indisponivel' }, { status: 503 })

    const idempotencyKey = `portal_boleto_${receivable.id}_${Date.now()}`
    const charge = await provider.createCharge({
      billingType: 'BOLETO',
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
        method: 'BOLETO',
        billing_type: 'BOLETO',
        invoice_url: charge.invoiceUrl,
        bank_slip_url: charge.bankSlipUrl || null,
        metadata: { source: 'portal', account_id: resolved.accountId, due_days: dueDays },
      },
    })

    await prisma.accountReceivable.update({
      where: { id: receivable.id },
      data: {
        charge_id: payment.id,
        charge_status: 'PENDING',
        charge_url: charge.invoiceUrl,
        due_date: dueDate,
        account_id: resolved.accountId,
      },
    })

    return NextResponse.json({
      data: {
        id: payment.id,
        receivable_id: receivable.id,
        invoice_url: charge.invoiceUrl,
        bank_slip_url: charge.bankSlipUrl,
        amount: payment.amount,
        status: payment.status,
        due_date: dueDate,
      },
    })
  } catch (err) {
    console.error('[Portal Boleto Create Error]', err)
    const msg = err instanceof Error ? err.message : 'Erro ao gerar boleto'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
