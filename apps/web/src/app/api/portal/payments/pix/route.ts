import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { getPaymentProviderForAccount } from '@/lib/payments/factory'
import { resolveDefaultProviderAccount } from '@/lib/payments/resolve-account'
import { canCustomerPayOS, PAYMENT_BLOCKED_MESSAGE } from '@/lib/os-payment-rules'
import { findActivePendingPaymentForOs, isOsAlreadyPaid } from '@/lib/payments/find-active-charge'

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
        customers: { select: { id: true, legal_name: true, document_number: true, email: true, mobile: true, phone: true } },
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

    // 2026-05-11 (Karlao OS 60475): bloqueia se OS ja paga
    if (await isOsAlreadyPaid(os.id, portalUser.company_id)) {
      return NextResponse.json({
        error: 'Esta OS ja foi paga. Acesse o portal pra ver o comprovante.',
        reason: 'os_already_paid',
      }, { status: 409 })
    }

    // 2026-05-11: regra "1 OS = 1 Payment PENDING max". Se ja ha cobranca
    // ATIVA em outro metodo (Boleto ou Cartao), bloqueia geracao de PIX.
    // Mesmo metodo PIX nao-expirado eh reusado mais abaixo via findFirst.
    const activeCharge = await findActivePendingPaymentForOs(os.id, portalUser.company_id)
    if (activeCharge && !activeCharge.expired && activeCharge.payment.billing_type && activeCharge.payment.billing_type !== 'PIX') {
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

    // 2026-05-11 (V6 bug 6 race fix): idempotency_key ESTÁVEL (sem timestamp)
    // por AR ativo. Payment.idempotency_key tem @unique no schema — 2º request
    // concurrent vai cair em P2002 e ser tratado como "reusa o vencedor".
    // Antes Payment antigo PENDING era reusado via findFirst, mas concurrent
    // reads dos 2 requests viam "vazio" e criavam 2 Payments diferentes (cada
    // um com timestamp único). Agora key é fixo por AR — 1 só ganha.
    //
    // Para permitir nova cobrança após Payment antigo virar CANCELLED/REFUNDED/etc,
    // renomeia o key antigo pra archived_<old_id>_<ts> antes de tentar criar novo.
    const idempotencyKey = `portal_pix_${receivable.id}`
    const existingByKey = await prisma.payment.findUnique({ where: { idempotency_key: idempotencyKey } })
    // 2026-05-11 (V7 bug 7): archive tambem se PENDING mas EXPIRADO. Antes
    // PIX expirado virava 'race_winner' mantido — cliente recebia link que
    // Asaas ja recusou. Agora libera slot pra novo PIX.
    const isExpiredPending = existingByKey?.status === 'PENDING'
      && existingByKey?.expires_at !== null
      && existingByKey?.expires_at !== undefined
      && new Date(existingByKey.expires_at) < new Date()
    if (existingByKey && (existingByKey.status !== 'PENDING' || isExpiredPending)) {
      await prisma.payment.update({
        where: { id: existingByKey.id },
        data: {
          idempotency_key: `archived_${existingByKey.id}_${Date.now()}`,
          ...(isExpiredPending && { status: 'EXPIRED' }),
        },
      })
    }
    const charge = await provider.createPixCharge({
      amount: remaining,
      customerName: os.customers.legal_name,
      customerDocument: os.customers.document_number,
      customerEmail: os.customers.email || undefined,
      customerPhone: os.customers.mobile || os.customers.phone || undefined,
      description: `OS #${os.os_number} - ${os.companies?.name || 'PontualERP'}`,
      idempotencyKey,
      expiresInMinutes: 30,
    })

    let payment
    try {
      payment = await prisma.payment.create({
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
    } catch (err: any) {
      // P2002 race condition: outro request concurrent ganhou. Retorna o existente.
      if (err?.code === 'P2002') {
        const winner = await prisma.payment.findUnique({ where: { idempotency_key: idempotencyKey } })
        if (winner) {
          return NextResponse.json({
            data: {
              id: winner.id,
              receivable_id: winner.receivable_id,
              qr_code: winner.qr_code,
              qr_code_image: winner.qr_code_image,
              amount: winner.amount,
              status: winner.status,
              expires_at: winner.expires_at,
              race_winner: true,
            },
          })
        }
      }
      throw err
    }

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
