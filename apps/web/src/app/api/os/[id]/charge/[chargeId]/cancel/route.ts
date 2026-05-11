import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getPaymentProviderForAccount } from '@/lib/payments/factory'
import { sendCompanyEmail } from '@/lib/send-email'
import { escapeHtml } from '@/lib/escape-html'

/**
 * POST /api/os/[id]/charge/[chargeId]/cancel
 *
 * Cancela cobranca PENDING — chama provider.cancelCharge no Asaas (deleta a
 * cobranca), marca Payment como CANCELLED, marca AR.charge_id=null, mantem
 * AR.status pra que outra cobranca possa ser gerada depois.
 *
 * Necessario pra regra "1 OS = 1 Payment PENDING max": se cliente quer
 * trocar PIX por Boleto, atendente cancela a PIX antes do cliente clicar
 * Boleto no portal.
 *
 * Permission: 'os:charge'.
 *
 * Casos:
 *  - Payment ja CONFIRMED/RECEIVED -> 409 (nao cancela cobranca paga)
 *  - Payment ja CANCELLED/REFUNDED -> 200 idempotente (no-op)
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string; chargeId: string } }) {
  try {
    const auth = await requirePermission('os', 'charge')
    if (auth instanceof NextResponse) return auth

    const payment = await prisma.payment.findUnique({
      where: { id: params.chargeId },
      include: {
        service_orders: {
          include: {
            customers: { select: { id: true, legal_name: true, email: true, mobile: true, phone: true } },
            companies: { select: { name: true } },
          },
        },
      },
    })
    if (!payment) return NextResponse.json({ error: 'Cobranca nao encontrada' }, { status: 404 })
    if (payment.company_id !== auth.companyId) {
      return NextResponse.json({ error: 'Cobranca de outra empresa' }, { status: 404 })
    }
    if (payment.service_order_id !== params.id) {
      return NextResponse.json({ error: 'Cobranca nao pertence a essa OS' }, { status: 400 })
    }

    if (payment.status === 'RECEIVED' || payment.status === 'CONFIRMED') {
      return NextResponse.json({
        error: 'Cobranca ja foi paga — nao pode ser cancelada. Use estorno se for o caso.',
        reason: 'already_paid',
      }, { status: 409 })
    }

    if (payment.status === 'CANCELLED' || payment.status === 'REFUNDED' || payment.status === 'DELETED') {
      return NextResponse.json({ success: true, idempotent: true, status: payment.status })
    }

    // Tenta cancelar no provider (Asaas). Se falhar (rede, IP block,
    // cobranca ja deletada do lado deles), continua e marca como CANCELLED
    // local — comentario interno no AR sinaliza atendente checar manualmente.
    let providerCancelled = false
    let providerError: string | null = null
    if (payment.external_id) {
      const accountId = (payment.metadata as any)?.account_id as string | undefined
      if (accountId) {
        const provider = await getPaymentProviderForAccount(accountId, auth.companyId)
        if (provider) {
          try {
            // PaymentProvider interface ainda não declara cancelCharge — só
            // AsaasProvider impl tem. Cast pra usar; se outro provider for
            // adicionado sem cancelCharge, catch trata e marca local como
            // CANCELLED igualmente.
            const p = provider as { cancelCharge?: (externalId: string) => Promise<void> }
            if (typeof p.cancelCharge === 'function') {
              await p.cancelCharge(payment.external_id)
              providerCancelled = true
            } else {
              providerError = 'provider sem método cancelCharge'
            }
          } catch (err) {
            providerError = err instanceof Error ? err.message : String(err)
            console.warn(`[OS Charge Cancel] provider.cancelCharge falhou pra ${payment.external_id}: ${providerError}`)
          }
        }
      }
    }

    // Marca payment como CANCELLED local independente do resultado provider
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'CANCELLED',
        cancelled_at: new Date(),
      },
    })

    // Limpa charge_id do AR pra outra cobranca poder ser gerada (mas mantem
    // AR.status PENDENTE — a divida continua existindo)
    if (payment.receivable_id) {
      await prisma.accountReceivable.update({
        where: { id: payment.receivable_id },
        data: {
          charge_id: null,
          charge_status: 'CANCELLED',
          charge_url: null,
          updated_at: new Date(),
        },
      })
    }

    // 2026-05-11: notifica cliente do cancelamento (Karlao reportou que nao
    // recebia email/WhatsApp). WhatsApp via texto livre (sem template — nao
    // ha pt_cobranca_cancel template). Fire-and-forget — falha nao bloqueia
    // resposta ao atendente.
    const os = payment.service_orders
    const customer = os?.customers
    const companyName = os?.companies?.name || 'PontualERP'
    const osNum = os ? String(os.os_number).padStart(4, '0') : ''
    const valorBRL = (payment.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    const metodoLabel: Record<string, string> = {
      PIX: 'PIX', BOLETO: 'Boleto', CREDIT_CARD: 'Cartao de credito',
    }
    const metodo = metodoLabel[payment.billing_type || ''] || payment.billing_type || payment.method || 'cobranca'

    let notifiedEmail = false
    let notifiedWhatsapp = false

    if (customer && os) {
      if (customer.email) {
        const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f5;padding:20px;">
          <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
            <div style="background:#dc2626;padding:24px 32px;color:#fff;">
              <h1 style="margin:0;font-size:20px;">${escapeHtml(companyName)}</h1>
              <p style="margin:4px 0 0;font-size:14px;">Cobranca cancelada — OS #${osNum}</p>
            </div>
            <div style="padding:32px;color:#1f2937;">
              <p>Ola, <strong>${escapeHtml(customer.legal_name || 'Cliente')}</strong>.</p>
              <p>Informamos que a cobranca referente a OS #${osNum} foi <strong>cancelada</strong>:</p>
              <table width="100%" cellpadding="8" style="background:#f9fafb;border-radius:6px;margin:16px 0;">
                <tr><td>Valor</td><td style="text-align:right;font-weight:bold;">${valorBRL}</td></tr>
                <tr><td>Forma</td><td style="text-align:right;">${metodo}</td></tr>
              </table>
              <p style="margin-top:16px;font-size:13px;color:#6b7280;">O link de pagamento anterior nao tem mais validade. Caso precise de uma nova forma de pagamento, entre em contato com nosso suporte.</p>
            </div>
          </div>
        </body></html>`
        try {
          await sendCompanyEmail(payment.company_id, customer.email, `Cobranca cancelada — OS #${osNum} — ${companyName}`, html)
          notifiedEmail = true
        } catch (e) {
          console.warn('[OS Charge Cancel] sendCompanyEmail falhou:', e instanceof Error ? e.message : e)
        }
      }
      const phone = customer.mobile || customer.phone
      if (phone) {
        const firstName = (customer.legal_name || 'Cliente').split(' ')[0]
        const msg = `Ola, ${firstName}. Informamos que a cobranca de ${valorBRL} (${metodo}) referente a OS #${osNum} foi *cancelada*. O link anterior nao e mais valido. Caso precise de nova forma de pagamento, entre em contato com nosso suporte.`
        try {
          const { sendWhatsAppCloud } = await import('@/lib/whatsapp/cloud-api')
          await sendWhatsAppCloud(payment.company_id, phone, msg)
          notifiedWhatsapp = true
        } catch (e) {
          console.warn('[OS Charge Cancel] sendWhatsAppCloud falhou:', e instanceof Error ? e.message : e)
        }
      }
    }

    logAudit({
      companyId: auth.companyId,
      userId: auth.id,
      module: 'os',
      action: 'charge_cancelled',
      entityId: params.id,
      newValue: {
        payment_id: payment.id,
        external_id: payment.external_id,
        provider_cancelled: providerCancelled,
        provider_error: providerError,
        notified_email: notifiedEmail,
        notified_whatsapp: notifiedWhatsapp,
      },
    })

    return NextResponse.json({
      success: true,
      payment_id: payment.id,
      provider_cancelled: providerCancelled,
      notified_email: notifiedEmail,
      notified_whatsapp: notifiedWhatsapp,
      ...(providerError && { provider_warning: 'Cancelamento local feito, mas provider falhou — verifique manualmente no Asaas se a cobranca foi removida.' }),
    })
  } catch (err) {
    console.error('[OS Charge Cancel] Error:', err)
    const msg = err instanceof Error ? err.message : 'Erro ao cancelar cobranca'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
