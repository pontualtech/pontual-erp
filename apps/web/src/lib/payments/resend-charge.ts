import { prisma } from '@pontual/db'
import { sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'
import { sendCompanyEmail } from '@/lib/send-email'
import { escapeHtml } from '@/lib/escape-html'
import { buildMagicLink } from '@/lib/portal-magic-url'

/**
 * resendCharge — reenvia link de pagamento JÁ EXISTENTE pra um cliente.
 *
 * Caso de uso: cliente diz "não recebi o boleto / link sumiu". Em vez de
 * criar uma nova cobrança no Asaas (custo + boleto duplicado), apenas
 * dispara WhatsApp + email com o invoice_url já persistido em Payment.
 *
 * NÃO toca no provedor (Asaas), NÃO cria Payment novo. O link continua
 * o mesmo. Pra cobranças PAID/REFUNDED, retorna erro — só PENDING é
 * candidato a reenvio.
 *
 * Chamado por:
 *  - `POST /api/os/[id]/charge/[chargeId]/resend` (UI atendente)
 *  - `POST /api/bot/reenviar-cobranca` (Marta autônoma)
 */
export type ResendChargeResult =
  | { ok: true; paymentId: string; invoice_url: string; sent_whatsapp: boolean; sent_email: boolean; status: string }
  | { ok: false; reason: 'not_found' | 'wrong_company' | 'not_pending' | 'no_invoice_url' | 'no_channels'; message: string; payment_status?: string }

export async function resendChargeByPaymentId(opts: {
  paymentId: string
  companyId: string
  sendWhatsApp?: boolean
  sendEmail?: boolean
}): Promise<ResendChargeResult> {
  const { paymentId, companyId } = opts
  const sendWhats = opts.sendWhatsApp !== false
  const sendEmailFlag = opts.sendEmail !== false

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      service_orders: {
        include: {
          customers: true,
          companies: { select: { name: true, slug: true } },
        },
      },
    },
  })

  if (!payment) return { ok: false, reason: 'not_found', message: 'Cobranca nao encontrada' }
  if (payment.company_id !== companyId) {
    return { ok: false, reason: 'wrong_company', message: 'Cobranca de outra empresa' }
  }
  if (payment.status !== 'PENDING') {
    return {
      ok: false,
      reason: 'not_pending',
      message: `Cobranca ja esta ${payment.status} — nao faz sentido reenviar`,
      payment_status: payment.status,
    }
  }
  if (!payment.invoice_url) {
    return { ok: false, reason: 'no_invoice_url', message: 'Cobranca sem link de pagamento' }
  }

  const os = payment.service_orders
  const customer = os?.customers
  if (!os || !customer) {
    return { ok: false, reason: 'not_found', message: 'OS ou cliente associado nao encontrado' }
  }

  const companyName = os.companies?.name || 'Empresa'
  const billingLabel: Record<string, string> = {
    PIX: 'PIX', BOLETO: 'Boleto Bancario', CREDIT_CARD: 'Cartao de Credito',
  }
  const billingType = payment.billing_type || 'BOLETO'
  const valueStr = `R$ ${(payment.amount / 100).toFixed(2).replace('.', ',')}`
  const osNum = String(os.os_number).padStart(4, '0')

  const sentVia: string[] = []

  if (sendWhats && customer.mobile) {
    const ml = buildMagicLink({
      customerId: os.customer_id,
      companyId,
      slug: os.companies?.slug || 'pontualtech',
      osId: os.id,
    })
    const fallback = `*Cobranca ${companyName} — OS #${osNum}* (reenvio)\n\nValor: ${valueStr}\nForma: ${billingLabel[billingType] || billingType}\n\nPagar:\n${payment.invoice_url}\n\nAcompanhar OS:\n${ml.url}`
    try {
      await sendWhatsAppTemplate(companyId, customer.mobile, 'pt_cobranca_v3', 'pt_BR', [
        { type: 'body', parameters: [
          { type: 'text', text: valueStr },
          { type: 'text', text: osNum },
        ] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: ml.token }] },
      ], fallback)
      sentVia.push('whatsapp')
    } catch (err) {
      console.warn('[resendCharge] WhatsApp falhou:', err instanceof Error ? err.message : err)
    }
  }

  if (sendEmailFlag && customer.email) {
    const dueDate = payment.due_date || payment.expires_at
    const dueStr = dueDate
      ? new Date(dueDate).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : '—'
    const emailHtml = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f5;padding:20px;">
      <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
        <div style="background:#059669;padding:24px 32px;color:#fff;">
          <h1 style="margin:0;font-size:20px;">${escapeHtml(companyName)}</h1>
          <p style="margin:4px 0 0;font-size:14px;">Reenvio: Cobranca OS #${os.os_number}</p>
        </div>
        <div style="padding:32px;">
          <p>Ola, <strong>${escapeHtml(customer.legal_name)}</strong>!</p>
          <p>Conforme solicitado, aqui esta novamente o link de pagamento da OS #${os.os_number}:</p>
          <table width="100%" cellpadding="8" style="background:#f9fafb;border-radius:6px;margin:16px 0;">
            <tr><td>Valor</td><td style="text-align:right;font-weight:bold;">${valueStr}</td></tr>
            <tr><td>Forma</td><td style="text-align:right;">${billingLabel[billingType] || billingType}</td></tr>
            <tr><td>Vencimento</td><td style="text-align:right;">${dueStr}</td></tr>
          </table>
          <a href="${payment.invoice_url}" style="display:block;text-align:center;background:#059669;color:#fff;padding:14px;border-radius:6px;text-decoration:none;font-weight:bold;">Pagar Agora</a>
          <p style="margin-top:20px;font-size:13px;color:#6b7280;">Se ja efetuou o pagamento, desconsidere este aviso — a confirmacao no nosso sistema acontece automaticamente em ate 2h uteis.</p>
        </div>
      </div>
    </body></html>`
    try {
      await sendCompanyEmail(
        companyId,
        customer.email,
        `Reenvio cobranca ${companyName} — OS #${os.os_number} — ${valueStr}`,
        emailHtml,
      )
      sentVia.push('email')
    } catch (err) {
      console.warn('[resendCharge] Email falhou:', err instanceof Error ? err.message : err)
    }
  }

  if (sentVia.length === 0) {
    return {
      ok: false,
      reason: 'no_channels',
      message: 'Cliente sem telefone/email validos OU canais desabilitados',
    }
  }

  if (payment.receivable_id) {
    await prisma.accountReceivable.update({
      where: { id: payment.receivable_id },
      data: { charge_sent_at: new Date(), charge_sent_via: sentVia.join(',') },
    }).catch(err => {
      console.warn('[resendCharge] Falha ao atualizar charge_sent_at:', err instanceof Error ? err.message : err)
    })
  }

  return {
    ok: true,
    paymentId: payment.id,
    invoice_url: payment.invoice_url,
    sent_whatsapp: sentVia.includes('whatsapp'),
    sent_email: sentVia.includes('email'),
    status: payment.status,
  }
}

/**
 * Conveniência para o bot: dado um número de OS, encontra a Payment PENDING
 * mais recente da OS e dispara o reenvio. Retorna `not_found` se a OS não
 * tiver cobrança PENDING (caller decide o que dizer ao cliente).
 */
export async function resendLatestPendingChargeByOsNumber(opts: {
  osNumber: number
  companyId: string
  sendWhatsApp?: boolean
  sendEmail?: boolean
}): Promise<ResendChargeResult> {
  const os = await prisma.serviceOrder.findFirst({
    where: { os_number: opts.osNumber, company_id: opts.companyId, deleted_at: null },
    select: { id: true },
  })
  if (!os) return { ok: false, reason: 'not_found', message: `OS #${opts.osNumber} nao encontrada` }

  const payment = await prisma.payment.findFirst({
    where: {
      service_order_id: os.id,
      company_id: opts.companyId,
      status: 'PENDING',
    },
    orderBy: { created_at: 'desc' },
    select: { id: true },
  })
  if (!payment) {
    return {
      ok: false,
      reason: 'not_found',
      message: `OS #${opts.osNumber} sem cobranca PENDING ativa`,
    }
  }

  return resendChargeByPaymentId({
    paymentId: payment.id,
    companyId: opts.companyId,
    sendWhatsApp: opts.sendWhatsApp,
    sendEmail: opts.sendEmail,
  })
}
