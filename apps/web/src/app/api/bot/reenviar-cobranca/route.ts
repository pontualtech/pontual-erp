import { NextRequest, NextResponse } from 'next/server'
import { authenticateBot } from '../_lib/auth'
import { botSuccess, botError } from '../_lib/response'
import { resendLatestPendingChargeByOsNumber } from '@/lib/payments/resend-charge'

/**
 * POST /api/bot/reenviar-cobranca
 *
 * Bot Marta autonomamente reenvia o link de pagamento de uma cobranca
 * existente quando cliente diz "nao recebi o boleto". Pega o Payment
 * PENDING mais recente da OS e reenvia WhatsApp + email com o mesmo
 * invoice_url ja persistido. NAO cria cobranca nova no Asaas.
 *
 * Auth: X-Bot-Key header (multi-tenant via BOT_*_API_KEY env).
 *
 * Body: { os_numero: number }
 *
 * Retorno:
 *  - 200 { ok: true, has_pending: true, sent_whatsapp, sent_email, payment_id }
 *    -> Marta diz: "Acabei de reenviar o boleto pelos mesmos canais"
 *  - 404 { ok: false, has_pending: false, reason: 'not_found', erro }
 *    -> Marta cai na regra 9 (registra pra financeiro conferir)
 *  - 409 { ok: false, has_pending: false, reason: 'not_pending', erro }
 *    -> Pagamento ja confirmado/expirado — Marta avisa cliente
 */
export async function POST(req: NextRequest) {
  try {
    const auth = authenticateBot(req)
    if (auth instanceof NextResponse) return auth

    const body = await req.json().catch(() => ({}))
    const osNumber = parseInt(String(body.os_numero || ''), 10)
    if (!osNumber || Number.isNaN(osNumber)) {
      return botError('Campo "os_numero" e obrigatorio')
    }

    const result = await resendLatestPendingChargeByOsNumber({
      osNumber,
      companyId: auth.companyId,
      sendWhatsApp: body.send_whatsapp !== false,
      sendEmail: body.send_email !== false,
    })

    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : result.reason === 'not_pending' ? 409 : 400
      return NextResponse.json({
        ok: false,
        has_pending: false,
        reason: result.reason,
        erro: result.message,
        payment_status: result.payment_status,
      }, { status })
    }

    return botSuccess({
      has_pending: true,
      payment_id: result.paymentId,
      invoice_url: result.invoice_url,
      sent_whatsapp: result.sent_whatsapp,
      sent_email: result.sent_email,
    })
  } catch (err) {
    console.error('[Bot Reenviar Cobranca] Error:', err)
    const msg = err instanceof Error ? err.message : 'Erro ao reenviar cobranca'
    return botError(msg, 500)
  }
}
