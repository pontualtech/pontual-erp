import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getPaymentProviderForAccount } from '@/lib/payments/factory'
import type { BillingType } from '@/lib/payments/types'
import { sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'
import { sendCompanyEmail } from '@/lib/send-email'
import { escapeHtml } from '@/lib/escape-html'
import { findActivePendingPaymentForOs, isOsAlreadyPaid } from '@/lib/payments/find-active-charge'
import { z } from 'zod'

/**
 * POST /api/os/[id]/charge
 *
 * Envia cobranca (link de pagamento) direto da tela de OS. Criado pra
 * permitir atendente disparar sem ter acesso ao modulo financeiro — usa
 * a permissao nova 'os:charge' (menos privilegiada que 'financeiro:create').
 *
 * Diferente de /api/financeiro/cobranca/charge:
 *  - Permissao mais restrita (os:charge)
 *  - Recebe ID da OS (nao do AR)
 *  - Cria o AR se nao existir (baseado no total_cost da OS)
 *  - Escolhe conta bancaria (account_id) pra determinar o provider
 *  - Grava account_id no AR pra relatorio mostrar qual banco foi usado
 *
 * Idempotency: idempotency_key = `os-charge-<osId>-<accountId>-<billingType>`
 */

const bodySchema = z.object({
  account_id: z.string().min(1),
  billing_type: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD']),
  due_days: z.number().int().min(1).max(90).optional(),
  installment_count: z.number().int().min(1).max(12).optional(),
  send_whatsapp: z.boolean().default(true),
  send_email: z.boolean().default(true),
})

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requirePermission('os', 'charge')
    if (auth instanceof NextResponse) return auth

    const body = await req.json().catch(() => ({}))
    const data = bodySchema.parse(body)

    // Load OS + customer + company
    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: auth.companyId, deleted_at: null },
      include: {
        customers: true,
        companies: { select: { name: true, slug: true } },
      },
    })
    if (!os) return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    if (!os.customers) return NextResponse.json({ error: 'OS sem cliente' }, { status: 400 })
    if (!os.customers.document_number) {
      return NextResponse.json({ error: 'Cliente sem CPF/CNPJ — obrigatorio para emitir cobranca' }, { status: 400 })
    }
    const amount = os.total_cost || 0
    if (amount <= 0) {
      return NextResponse.json({ error: 'OS sem valor — defina um orcamento antes de cobrar' }, { status: 400 })
    }

    // 2026-05-11 (Karlao OS 60475): bloqueia nova cobranca se OS ja paga
    // (Payment CONFIRMED/RECEIVED OU AR RECEBIDO). Antes do check de
    // "1 Payment PENDING max" porque mesmo sem PENDING ativo, OS paga
    // nao deve aceitar nova cobranca.
    const alreadyPaid = await isOsAlreadyPaid(params.id, auth.companyId)
    if (alreadyPaid) {
      return NextResponse.json({
        error: 'Esta OS ja foi paga — nao gere nova cobranca. Se houve estorno, registre primeiro.',
        reason: 'os_already_paid',
      }, { status: 409 })
    }

    // 2026-05-11: regra de dominio "1 OS = 1 Payment PENDING max"
    // (caso real Karlao OS 60471: clicou Cobrar e gerou 2 cobrancas em
    // metodos diferentes pra mesma OS). Antes do provider.createCharge,
    // valida se ja ha cobranca ativa qualquer metodo.
    const activeCharge = await findActivePendingPaymentForOs(params.id, auth.companyId)
    if (activeCharge && !activeCharge.expired) {
      const existingMethod = activeCharge.payment.billing_type || activeCharge.payment.method || 'cobrança'
      const sameMethod = activeCharge.payment.billing_type === data.billing_type
      if (sameMethod) {
        // Mesmo metodo nao-expirado: reusa (consistente com portal endpoints)
        return NextResponse.json({
          success: true,
          reused: true,
          payment: {
            id: activeCharge.payment.id,
            invoice_url: activeCharge.payment.invoice_url,
            bank_slip_url: activeCharge.payment.bank_slip_url,
            pix_qr_code: activeCharge.payment.qr_code,
            billing_type: activeCharge.payment.billing_type,
            amount: activeCharge.payment.amount,
            status: 'PENDING',
          },
        })
      }
      return NextResponse.json({
        error: `Ja existe cobranca ${existingMethod} ativa pra essa OS. Cancele ou aguarde a expiracao antes de gerar outra forma.`,
        reason: 'active_charge_exists',
        active_payment: {
          id: activeCharge.payment.id,
          billing_type: activeCharge.payment.billing_type,
          invoice_url: activeCharge.payment.invoice_url,
          amount: activeCharge.payment.amount,
          created_at: activeCharge.payment.created_at,
        },
      }, { status: 409 })
    }

    // Resolve provider via account
    const provider = await getPaymentProviderForAccount(data.account_id, auth.companyId)
    if (!provider) {
      return NextResponse.json({ error: 'Conta bancaria nao encontrada ou sem configuracao valida' }, { status: 400 })
    }

    // Busca ou cria AR — pro AR ja existir, o usuario pode ter criado manual antes
    let receivable = await prisma.accountReceivable.findFirst({
      where: {
        company_id: auth.companyId,
        service_order_id: os.id,
        status: { in: ['PENDENTE', 'PARCIAL'] },
        deleted_at: null,
      },
      orderBy: { created_at: 'desc' },
    })

    const due = new Date()
    due.setDate(due.getDate() + (data.due_days || 7))

    if (!receivable) {
      receivable = await prisma.accountReceivable.create({
        data: {
          company_id: auth.companyId,
          customer_id: os.customer_id,
          service_order_id: os.id,
          account_id: data.account_id,
          description: `Cobranca OS #${os.os_number}`,
          total_amount: amount,
          received_amount: 0,
          due_date: due,
          status: 'PENDENTE',
          payment_method: data.billing_type,
          notes: `Cobranca emitida pela OS por ${auth.name}`,
        },
      })
    } else if (!receivable.account_id) {
      // Se AR existia mas sem account_id (legado), atualiza
      await prisma.accountReceivable.update({
        where: { id: receivable.id },
        data: { account_id: data.account_id, payment_method: data.billing_type, due_date: due },
      })
    }

    // Idempotency — 1 cobranca ativa por (OS, conta, tipo)
    const idempotencyKey = `os-charge-${os.id}-${data.account_id}-${data.billing_type}`
    const existing = await prisma.payment.findUnique({
      where: { idempotency_key: idempotencyKey },
    })
    if (existing) {
      return NextResponse.json({
        error: 'Ja existe uma cobranca ativa com essa conta e tipo',
        payment: {
          id: existing.id,
          invoice_url: existing.invoice_url,
          billing_type: existing.billing_type,
          status: existing.status,
        },
      }, { status: 409 })
    }

    // Create charge no provider
    const remaining = receivable.total_amount - (receivable.received_amount || 0)
    if (remaining <= 0) {
      return NextResponse.json({ error: 'Sem valor pendente' }, { status: 400 })
    }
    const charge = await provider.createCharge({
      billingType: data.billing_type as BillingType,
      amount: remaining,
      customerName: os.customers.legal_name,
      customerDocument: os.customers.document_number,
      customerEmail: os.customers.email || undefined,
      description: receivable.description || `OS #${os.os_number}`,
      dueDate: due.toISOString().split('T')[0],
      installmentCount: data.billing_type === 'CREDIT_CARD' ? data.installment_count : undefined,
    })

    // Grava Payment + atualiza AR
    const payment = await prisma.payment.create({
      data: {
        company_id: auth.companyId,
        customer_id: os.customer_id,
        service_order_id: os.id,
        receivable_id: receivable.id,
        provider: provider.name,
        external_id: charge.externalId,
        idempotency_key: idempotencyKey,
        amount: remaining,
        status: 'PENDING',
        method: data.billing_type,
        billing_type: data.billing_type,
        invoice_url: charge.invoiceUrl,
        bank_slip_url: charge.bankSlipUrl || null,
        qr_code: charge.pixQrCode || null,
        qr_code_image: charge.pixQrCodeImage || null,
        expires_at: data.billing_type === 'PIX' ? new Date(Date.now() + 30 * 60 * 1000) : null,
        metadata: {
          source: 'os-charge',
          os_number: os.os_number,
          account_id: data.account_id,
        },
      },
    })

    await prisma.accountReceivable.update({
      where: { id: receivable.id },
      data: {
        charge_id: payment.id,
        charge_status: 'PENDING',
        charge_url: charge.invoiceUrl,
        account_id: data.account_id,
        payment_method: data.billing_type,
      },
    })

    // Mensagens — fire-and-forget
    const companyName = os.companies?.name || 'Empresa'
    const valueStr = `R$ ${(remaining / 100).toFixed(2).replace('.', ',')}`
    const billingLabel: Record<string, string> = {
      PIX: 'PIX', BOLETO: 'Boleto Bancario', CREDIT_CARD: 'Cartao de Credito',
    }
    const sentVia: string[] = []

    if (data.send_whatsapp && os.customers.mobile) {
      const osNum = String(os.os_number).padStart(4, '0')
      // pt_cobranca_v3: BODY {{1}}=valor, {{2}}=os_num. URL button {{1}}=magic_token.
      const { buildMagicLink: bml } = await import('@/lib/portal-magic-url')
      const ml = bml({ customerId: os.customer_id, companyId: auth.companyId, slug: os.companies?.slug || 'pontualtech', osId: os.id })
      const fallback = `*Cobranca PontualTech — OS #${osNum}*\n\nValor: ${valueStr}\nForma: ${billingLabel[data.billing_type]}\n\nPagar:\n${charge.invoiceUrl}\n\nAcompanhar OS:\n${ml.url}`
      sendWhatsAppTemplate(auth.companyId, os.customers.mobile, 'pt_cobranca_v3', 'pt_BR', [
        { type: 'body', parameters: [
          { type: 'text', text: valueStr },
          { type: 'text', text: osNum },
        ] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: ml.token }] },
      ], fallback).catch(() => {})
      sentVia.push('whatsapp')
    }

    if (data.send_email && os.customers.email) {
      const dueStr = due.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      const emailHtml = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f5;padding:20px;">
        <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
          <div style="background:#059669;padding:24px 32px;color:#fff;">
            <h1 style="margin:0;font-size:20px;">${escapeHtml(companyName)}</h1>
            <p style="margin:4px 0 0;font-size:14px;">Cobranca OS #${os.os_number}</p>
          </div>
          <div style="padding:32px;">
            <p>Ola, <strong>${escapeHtml(os.customers.legal_name)}</strong>!</p>
            <p>Voce tem uma cobranca pendente da OS #${os.os_number}.</p>
            <table width="100%" cellpadding="8" style="background:#f9fafb;border-radius:6px;margin:16px 0;">
              <tr><td>Valor</td><td style="text-align:right;font-weight:bold;">${valueStr}</td></tr>
              <tr><td>Forma</td><td style="text-align:right;">${billingLabel[data.billing_type]}</td></tr>
              <tr><td>Vencimento</td><td style="text-align:right;">${dueStr}</td></tr>
            </table>
            <a href="${charge.invoiceUrl}" style="display:block;text-align:center;background:#059669;color:#fff;padding:14px;border-radius:6px;text-decoration:none;font-weight:bold;">Pagar Agora</a>
          </div>
        </div>
      </body></html>`
      sendCompanyEmail(auth.companyId, os.customers.email,
        `Cobranca ${companyName} — OS #${os.os_number} — ${valueStr}`, emailHtml).catch(() => {})
      sentVia.push('email')
    }

    if (sentVia.length > 0) {
      await prisma.accountReceivable.update({
        where: { id: receivable.id },
        data: { charge_sent_at: new Date(), charge_sent_via: sentVia.join(',') },
      })
    }

    logAudit({
      companyId: auth.companyId,
      userId: auth.id,
      module: 'os',
      action: 'charge_sent',
      entityId: os.id,
      newValue: {
        receivable_id: receivable.id,
        payment_id: payment.id,
        account_id: data.account_id,
        billing_type: data.billing_type,
        amount: remaining,
        sent_via: sentVia,
      },
    })

    return NextResponse.json({
      success: true,
      payment: {
        id: payment.id,
        invoice_url: charge.invoiceUrl,
        bank_slip_url: charge.bankSlipUrl,
        pix_qr_code: charge.pixQrCode,
        billing_type: data.billing_type,
        amount: remaining,
        status: 'PENDING',
      },
      receivable_id: receivable.id,
      sent_whatsapp: sentVia.includes('whatsapp'),
      sent_email: sentVia.includes('email'),
    })
  } catch (err) {
    console.error('[OS Charge] Error:', err)
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Dados invalidos', details: err.errors }, { status: 400 })
    }
    const msg = err instanceof Error ? err.message : 'Erro ao criar cobranca'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * GET /api/os/[id]/charge
 *
 * Lista cobrancas ja enviadas pra essa OS — mostra no histórico da OS.
 * Permissao: os:view (se tem acesso a OS, tem acesso ao historico dela).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requirePermission('os', 'view')
    if (auth instanceof NextResponse) return auth

    const payments = await prisma.payment.findMany({
      where: { service_order_id: params.id, company_id: auth.companyId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, provider: true, method: true, billing_type: true, amount: true,
        status: true, invoice_url: true, bank_slip_url: true, paid_at: true,
        created_at: true, expires_at: true, receivable_id: true,
        metadata: true,
      },
    })

    // Enriquecer com nome da conta (se tiver account_id no metadata)
    const accountIds = Array.from(new Set(
      payments.map(p => (p.metadata as Record<string, string>)?.account_id).filter(Boolean)
    )) as string[]
    const accounts = accountIds.length
      ? await prisma.account.findMany({
          where: { id: { in: accountIds }, company_id: auth.companyId },
          select: { id: true, name: true, bank_name: true },
        })
      : []
    const accById = new Map(accounts.map(a => [a.id, a]))

    return NextResponse.json({
      data: payments.map(p => {
        const accId = (p.metadata as Record<string, string>)?.account_id
        const acc = accId ? accById.get(accId) : null
        return {
          ...p,
          account: acc ? { id: acc.id, name: acc.name, bank_name: acc.bank_name } : null,
        }
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
