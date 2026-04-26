import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { getPaymentProviderForAccount } from '@/lib/payments/factory'
import { resolveDefaultProviderAccount } from '@/lib/payments/resolve-account'
import { canCustomerPayOS, PAYMENT_BLOCKED_MESSAGE } from '@/lib/os-payment-rules'

/**
 * POST /api/portal/payments/pix
 * Body: { service_order_id: string }
 *
 * Gera PIX no Asaas (ou outro provider da conta) pra cliente pagar a OS
 * via portal, antes mesmo do motorista finalizar a entrega.
 *
 * Fluxo:
 *  1. Autentica cliente no portal (cookie)
 *  2. Valida OS existe e pertence ao cliente
 *  3. Busca ou CRIA AccountReceivable PENDENTE vinculado a OS
 *  4. Cria Payment PIX com receivable_id (pra webhook auto-baixar)
 *  5. Idempotency: se existe PIX pendente nao-expirado, reusa
 *
 * Webhook `/api/webhooks/payment` trata o PAYMENT_RECEIVED e faz a
 * baixa automatica no AR quando Asaas confirma.
 */
export async function POST(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

    const { service_order_id } = await req.json().catch(() => ({}))
    if (!service_order_id) return NextResponse.json({ error: 'service_order_id obrigatorio' }, { status: 400 })

    // 1. Autoriza + carrega OS (inclui status pra checar se pagamento esta liberado)
    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: service_order_id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      include: {
        customers: { select: { id: true, legal_name: true, document_number: true, email: true } },
        companies: { select: { name: true } },
        module_statuses: { select: { name: true } },
      },
    })
    if (!os) return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    if (!os.total_cost || os.total_cost <= 0) {
      return NextResponse.json({ error: 'OS sem valor definido — aguarde o orçamento' }, { status: 400 })
    }
    if (!os.customers?.document_number) {
      return NextResponse.json({ error: 'Cadastro sem CPF/CNPJ — complete o cadastro pra emitir cobrança' }, { status: 400 })
    }

    // Status atual permite pagamento? (so libera apos cliente aprovar reparo)
    if (!canCustomerPayOS(os.module_statuses?.name)) {
      return NextResponse.json({ error: PAYMENT_BLOCKED_MESSAGE }, { status: 422 })
    }

    // 2. Busca conta bancaria com provider Asaas configurado
    const resolved = await resolveDefaultProviderAccount(portalUser.company_id)
    if (!resolved) {
      return NextResponse.json({ error: 'Empresa sem conta de pagamento configurada' }, { status: 503 })
    }

    // 3. Busca ou cria AR pendente pra essa OS
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
      // Categoria padrao de receita ("Venda de Servicos")
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
          description: `Cobranca OS #${os.os_number} (gerado pelo cliente no portal)`,
          total_amount: os.total_cost,
          received_amount: 0,
          due_date: new Date(),
          status: 'PENDENTE',
          payment_method: 'PIX',
          notes: 'Cliente gerou PIX via portal',
        },
      })
    }

    // 4. Idempotency: PIX ativo nao-expirado? reusa
    const remaining = receivable.total_amount - (receivable.received_amount || 0)
    if (remaining <= 0) return NextResponse.json({ error: 'Esta OS ja foi paga' }, { status: 400 })

    const existing = await prisma.payment.findFirst({
      where: {
        receivable_id: receivable.id,
        method: 'PIX',
        status: 'PENDING',
        expires_at: { gte: new Date() },
      },
      orderBy: { created_at: 'desc' },
    })
    if (existing) {
      return NextResponse.json({
        data: {
          id: existing.id,
          receivable_id: receivable.id,
          qr_code: existing.qr_code,
          qr_code_image: existing.qr_code_image,
          amount: existing.amount,
          status: existing.status,
          expires_at: existing.expires_at,
        },
      })
    }

    // 5. Cria PIX no provider
    const provider = await getPaymentProviderForAccount(resolved.accountId, portalUser.company_id)
    if (!provider) return NextResponse.json({ error: 'Provider indisponivel' }, { status: 503 })

    const idempotencyKey = `portal_pix_${receivable.id}_${Date.now()}`
    const charge = await provider.createPixCharge({
      amount: remaining,
      customerName: os.customers.legal_name,
      customerDocument: os.customers.document_number,
      description: `OS #${os.os_number} - ${os.companies?.name || 'PontualERP'}`,
      idempotencyKey,
      expiresInMinutes: 30,
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
        method: 'PIX',
        billing_type: 'PIX',
        qr_code: charge.qrCode,
        qr_code_image: charge.qrCodeImage || null,
        expires_at: charge.expiresAt,
        metadata: { source: 'portal', account_id: resolved.accountId },
      },
    })

    // Vincula charge no AR
    await prisma.accountReceivable.update({
      where: { id: receivable.id },
      data: {
        charge_id: payment.id,
        charge_status: 'PENDING',
        payment_method: 'PIX',
        account_id: resolved.accountId,
      },
    })

    return NextResponse.json({
      data: {
        id: payment.id,
        receivable_id: receivable.id,
        qr_code: payment.qr_code,
        qr_code_image: payment.qr_code_image,
        amount: payment.amount,
        status: payment.status,
        expires_at: payment.expires_at,
      },
    })
  } catch (err) {
    console.error('[Portal PIX Create Error]', err)
    const msg = err instanceof Error ? err.message : 'Erro ao gerar PIX'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
