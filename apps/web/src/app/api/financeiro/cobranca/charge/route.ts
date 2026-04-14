import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getPaymentProvider } from '@/lib/payments/factory'
import type { BillingType } from '@/lib/payments/types'
import { sendWhatsApp } from '@/lib/whatsapp/evolution'
import { sendCompanyEmail } from '@/lib/send-email'
import { z } from 'zod'
import { escapeHtml } from '@/lib/escape-html'

const createChargeSchema = z.object({
  receivable_id: z.string().min(1),
  billing_type: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD']),
  send_whatsapp: z.boolean().default(true),
  send_email: z.boolean().default(true),
  installment_count: z.number().min(1).max(12).optional(),
})

/**
 * POST /api/financeiro/cobranca/charge
 * Create a charge in Asaas for an accounts receivable and send payment link
 */
export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = createChargeSchema.parse(body)

    // Load receivable with customer and company
    const receivable = await prisma.accountReceivable.findFirst({
      where: {
        id: data.receivable_id,
        company_id: user.companyId,
        deleted_at: null,
      },
      include: {
        customers: true,
        companies: true,
      },
    })

    if (!receivable) {
      return NextResponse.json({ error: 'Conta a receber nao encontrada' }, { status: 404 })
    }

    if (receivable.status === 'RECEBIDO') {
      return NextResponse.json({ error: 'Conta ja recebida' }, { status: 400 })
    }

    if (receivable.status === 'CANCELADO') {
      return NextResponse.json({ error: 'Conta cancelada' }, { status: 400 })
    }

    const customer = receivable.customers
    if (!customer) {
      return NextResponse.json({ error: 'Conta sem cliente vinculado' }, { status: 400 })
    }

    if (!customer.document_number) {
      return NextResponse.json({ error: 'Cliente sem CPF/CNPJ cadastrado' }, { status: 400 })
    }

    // Check for existing charge by idempotency key (prevents race condition on double-click)
    const idempotencyKey = `charge_${data.receivable_id}`
    const byKey = await prisma.payment.findUnique({
      where: { idempotency_key: idempotencyKey },
    })
    if (byKey) {
      return NextResponse.json({
        error: 'Ja existe uma cobranca para esta conta',
        payment: {
          id: byKey.id,
          invoice_url: byKey.invoice_url,
          billing_type: byKey.billing_type,
          status: byKey.status,
        },
      }, { status: 409 })
    }

    // Also check for pending charges (belt-and-suspenders)
    const existingPayment = await prisma.payment.findFirst({
      where: {
        receivable_id: data.receivable_id,
        status: 'PENDING',
        company_id: user.companyId,
      },
    })

    if (existingPayment) {
      return NextResponse.json({
        error: 'Ja existe uma cobranca pendente para esta conta',
        payment: {
          id: existingPayment.id,
          invoice_url: existingPayment.invoice_url,
          billing_type: existingPayment.billing_type,
          status: existingPayment.status,
        },
      }, { status: 409 })
    }

    // Calculate remaining amount
    const remaining = receivable.total_amount - (receivable.received_amount || 0)
    if (remaining <= 0) {
      return NextResponse.json({ error: 'Sem valor pendente' }, { status: 400 })
    }

    // Create charge via payment provider (Asaas)
    const provider = getPaymentProvider()
    const charge = await provider.createCharge({
      billingType: data.billing_type as BillingType,
      amount: remaining,
      customerName: customer.legal_name,
      customerDocument: customer.document_number,
      customerEmail: customer.email || undefined,
      description: receivable.description || `Cobranca #${receivable.id.slice(0, 8)}`,
      dueDate: receivable.due_date
        ? new Date(receivable.due_date).toISOString().split('T')[0]
        : undefined,
      installmentCount: data.billing_type === 'CREDIT_CARD' ? data.installment_count : undefined,
    })

    // Save payment record linked to receivable
    const payment = await prisma.payment.create({
      data: {
        company_id: user.companyId,
        customer_id: customer.id,
        receivable_id: data.receivable_id,
        provider: provider.name,
        external_id: charge.externalId,
        idempotency_key: `charge_${data.receivable_id}`,
        amount: remaining,
        status: 'PENDING',
        method: data.billing_type,
        billing_type: data.billing_type,
        invoice_url: charge.invoiceUrl,
        bank_slip_url: charge.bankSlipUrl || null,
        qr_code: charge.pixQrCode || null,
        qr_code_image: charge.pixQrCodeImage || null,
        expires_at: data.billing_type === 'PIX'
          ? new Date(Date.now() + 30 * 60 * 1000)
          : null,
        metadata: {
          receivable_description: receivable.description,
          customer_name: customer.legal_name,
        },
      },
    })

    // Update receivable with charge info
    await prisma.accountReceivable.update({
      where: { id: data.receivable_id },
      data: {
        charge_id: payment.id,
        charge_status: 'PENDING',
        charge_url: charge.invoiceUrl,
        updated_at: new Date(),
      },
    })

    // Build payment link message and send notifications
    const companyName = receivable.companies?.name || 'Empresa'
    const valueStr = `R$ ${(remaining / 100).toFixed(2).replace('.', ',')}`
    const billingLabel: Record<string, string> = {
      PIX: 'PIX',
      BOLETO: 'Boleto Bancario',
      CREDIT_CARD: 'Cartao de Credito',
    }
    const sentVia: string[] = []

    // Send via WhatsApp (fire-and-forget)
    if (data.send_whatsapp && customer.mobile) {
      const whatsMsg =
        `Ola, *${customer.legal_name}*! 💰\n\n` +
        `Voce tem uma cobranca de *${valueStr}* da *${companyName}*.\n` +
        `Forma de pagamento: *${billingLabel[data.billing_type]}*\n\n` +
        `📱 Pague agora pelo link:\n${charge.invoiceUrl}\n\n` +
        (receivable.description ? `Ref: ${receivable.description}\n` : '') +
        `Qualquer duvida, entre em contato conosco!\n\n` +
        `⚙️ Esta e uma mensagem automatica.`

      sendWhatsApp(customer.mobile, whatsMsg).then(r => {
        if (r.success) sentVia.push('whatsapp')
      }).catch(() => {})
    }

    // Send via Email (fire-and-forget)
    if (data.send_email && customer.email) {
      const dueStr = receivable.due_date
        ? new Date(receivable.due_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
        : ''

      const emailHtml = buildChargeEmailHtml({
        customerName: customer.legal_name,
        companyName,
        value: valueStr,
        billingType: billingLabel[data.billing_type],
        description: receivable.description,
        dueDate: dueStr,
        invoiceUrl: charge.invoiceUrl,
      })

      sendCompanyEmail(
        user.companyId,
        customer.email,
        `Cobranca ${companyName} - ${valueStr}`,
        emailHtml
      ).then(ok => {
        if (ok) sentVia.push('email')
      }).catch(() => {})
    }

    // Update sent tracking immediately (channels are known at request time)
    const via: string[] = []
    if (data.send_whatsapp && customer.mobile) via.push('whatsapp')
    if (data.send_email && customer.email) via.push('email')
    if (via.length > 0) {
      await prisma.accountReceivable.update({
        where: { id: data.receivable_id },
        data: {
          charge_sent_at: new Date(),
          charge_sent_via: via.join(','),
        },
      })
    }

    // Audit log (fire-and-forget)
    // Fire-and-forget audit log
    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'charge_created',
      entityId: data.receivable_id,
      newValue: {
        payment_id: payment.id,
        billing_type: data.billing_type,
        amount: remaining,
        invoice_url: charge.invoiceUrl,
        sent_whatsapp: data.send_whatsapp && !!customer.mobile,
        sent_email: data.send_email && !!customer.email,
      },
    })

    return NextResponse.json({
      success: true,
      payment: {
        id: payment.id,
        external_id: charge.externalId,
        billing_type: data.billing_type,
        amount: remaining,
        invoice_url: charge.invoiceUrl,
        bank_slip_url: charge.bankSlipUrl,
        pix_qr_code: charge.pixQrCode,
        status: 'PENDING',
      },
      sent_whatsapp: data.send_whatsapp && !!customer.mobile,
      sent_email: data.send_email && !!customer.email,
    })
  } catch (err) {
    console.error('[Charge] Error:', err)
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Dados invalidos', details: err.errors }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'Erro ao criar cobranca' },
      { status: 500 }
    )
  }
}

function buildChargeEmailHtml(params: {
  customerName: string
  companyName: string
  value: string
  billingType: string
  description: string
  dueDate: string
  invoiceUrl: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden">
  <tr>
    <td style="background:#059669;padding:24px 32px">
      <h1 style="color:#fff;margin:0;font-size:20px">${escapeHtml(params.companyName)}</h1>
      <p style="color:#d1fae5;margin:4px 0 0;font-size:14px">Cobranca</p>
    </td>
  </tr>
  <tr>
    <td style="padding:32px">
      <p style="font-size:16px;color:#1f2937;margin:0 0 16px">
        Ola, <strong>${escapeHtml(params.customerName)}</strong>!
      </p>
      <p style="font-size:14px;color:#4b5563;margin:0 0 24px">
        Voce tem uma cobranca pendente. Confira os detalhes:
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin-bottom:24px">
        <tr>
          <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb">Valor</td>
          <td style="padding:12px 16px;font-size:18px;font-weight:bold;color:#059669;text-align:right;border-bottom:1px solid #e5e7eb">${params.value}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb">Forma de Pagamento</td>
          <td style="padding:12px 16px;font-size:14px;color:#1f2937;text-align:right;border-bottom:1px solid #e5e7eb">${params.billingType}</td>
        </tr>
        ${params.dueDate ? `<tr>
          <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb">Vencimento</td>
          <td style="padding:12px 16px;font-size:14px;color:#1f2937;text-align:right;border-bottom:1px solid #e5e7eb">${params.dueDate}</td>
        </tr>` : ''}
        ${params.description ? `<tr>
          <td style="padding:12px 16px;font-size:13px;color:#6b7280">Referencia</td>
          <td style="padding:12px 16px;font-size:14px;color:#1f2937;text-align:right">${escapeHtml(params.description)}</td>
        </tr>` : ''}
      </table>
      <a href="${params.invoiceUrl}" style="display:block;text-align:center;background:#059669;color:#fff;padding:14px 24px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold">
        Pagar Agora
      </a>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:16px 0 0">
        Ou copie e cole: <a href="${params.invoiceUrl}" style="color:#059669;word-break:break-all">${params.invoiceUrl}</a>
      </p>
    </td>
  </tr>
  <tr>
    <td style="padding:0 32px 24px;">
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;text-align:center;">
        <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0369a1;">📱 Acompanhe sua OS</p>
        <p style="margin:0 0 12px;font-size:13px;color:#0c4a6e;">Acesse o Portal do Cliente ou consulte pelo nosso site:</p>
        <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
          <td style="padding:0 6px;"><a href="https://portal.pontualtech.com.br" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Portal do Cliente</a></td>
          <td style="padding:0 6px;"><a href="https://pontualtech.com.br/#consulta-os" style="display:inline-block;padding:10px 20px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Consultar no Site</a></td>
        </tr></table>
        <p style="margin:12px 0 0;font-size:13px;color:#0c4a6e;">Duvidas? Fale com nosso suporte:</p>
        <table cellpadding="0" cellspacing="0" style="margin:8px auto 0;"><tr>
          <td><a href="https://wa.me/551126263841" style="display:inline-block;padding:10px 24px;background:#25d366;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">💬 WhatsApp Suporte</a></td>
        </tr></table>
      </div>
    </td>
  </tr>
  <tr>
    <td style="background:#f9fafb;padding:16px 32px;text-align:center">
      <p style="font-size:12px;color:#9ca3af;margin:0">⚙️ Esta e uma mensagem automatica. Nao responda diretamente este email.</p>
    </td>
  </tr>
</table>
</body>
</html>`
}
