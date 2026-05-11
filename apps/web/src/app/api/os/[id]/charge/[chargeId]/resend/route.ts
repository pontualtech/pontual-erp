import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { resendChargeByPaymentId } from '@/lib/payments/resend-charge'
import { z } from 'zod'

/**
 * POST /api/os/[id]/charge/[chargeId]/resend
 *
 * Reenvia o link de pagamento de uma cobranca JA EXISTENTE (Payment com
 * status PENDING). NAO cria nova cobranca no Asaas — apenas redispara
 * WhatsApp + email com o `invoice_url` ja persistido.
 *
 * Caso de uso: cliente liga e diz "nao recebi o boleto / link sumiu".
 * Atendente clica em "Reenviar" no histórico de cobrancas dentro do
 * modal de cobranca da OS, sem precisar abrir o modulo financeiro.
 *
 * Permissao: 'os:charge' (mesma do POST /charge — quem pode criar pode
 * reenviar).
 */
const bodySchema = z.object({
  send_whatsapp: z.boolean().optional().default(true),
  send_email: z.boolean().optional().default(true),
})

export async function POST(req: NextRequest, { params }: { params: { id: string; chargeId: string } }) {
  try {
    const auth = await requirePermission('os', 'charge')
    if (auth instanceof NextResponse) return auth

    const body = await req.json().catch(() => ({}))
    const data = bodySchema.parse(body)

    const result = await resendChargeByPaymentId({
      paymentId: params.chargeId,
      companyId: auth.companyId,
      sendWhatsApp: data.send_whatsapp,
      sendEmail: data.send_email,
    })

    if (!result.ok) {
      const status = result.reason === 'not_found' || result.reason === 'wrong_company'
        ? 404
        : result.reason === 'not_pending'
        ? 409
        : 400
      return NextResponse.json({ error: result.message, reason: result.reason, payment_status: result.payment_status }, { status })
    }

    logAudit({
      companyId: auth.companyId,
      userId: auth.id,
      module: 'os',
      action: 'charge_resent',
      entityId: params.id,
      newValue: {
        payment_id: result.paymentId,
        sent_whatsapp: result.sent_whatsapp,
        sent_email: result.sent_email,
      },
    })

    return NextResponse.json({
      success: true,
      payment_id: result.paymentId,
      invoice_url: result.invoice_url,
      sent_whatsapp: result.sent_whatsapp,
      sent_email: result.sent_email,
    })
  } catch (err) {
    console.error('[OS Charge Resend] Error:', err)
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Dados invalidos', details: err.errors }, { status: 400 })
    }
    const msg = err instanceof Error ? err.message : 'Erro ao reenviar cobranca'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
