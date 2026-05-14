import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { resendChargeByPaymentId } from '@/lib/payments/resend-charge'
import { logAudit } from '@/lib/audit'
import { handleError } from '@/lib/api-response'

/**
 * POST /api/financeiro/cobranca/bulk-resend
 *
 * Reenvia em massa o link de cobranca de varios AccountReceivable que
 * tem cobranca ativa (charge_id != null E charge_status compativel).
 * Reutiliza resendChargeByPaymentId — nao cria cobranca nova.
 *
 * Feature 2026-05-14 (feat 2/4): permite atendente selecionar varios
 * ARs vencendo/vencidos e disparar reenvio em 1 click.
 *
 * Body: { receivable_ids: string[], send_whatsapp?: boolean, send_email?: boolean }
 */
const bodySchema = z.object({
  receivable_ids: z.array(z.string().min(1)).min(1).max(50),
  send_whatsapp: z.boolean().optional().default(true),
  send_email: z.boolean().optional().default(true),
})

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('financeiro', 'edit')
    if (auth instanceof NextResponse) return auth

    const body = await req.json()
    const data = bodySchema.parse(body)

    // Carrega ARs validos do tenant com charge_id presente
    const receivables = await prisma.accountReceivable.findMany({
      where: {
        id: { in: data.receivable_ids },
        company_id: auth.companyId,
        deleted_at: null,
        charge_id: { not: null },
      },
      select: { id: true, charge_id: true, description: true },
    })

    const results: Array<{
      receivable_id: string
      ok: boolean
      reason?: string
      message?: string
      sent_whatsapp?: boolean
      sent_email?: boolean
    }> = []

    // Processa serialmente — Asaas tem rate limit. 50 maximo via schema.
    for (const r of receivables) {
      if (!r.charge_id) continue
      const result = await resendChargeByPaymentId({
        paymentId: r.charge_id,
        companyId: auth.companyId,
        sendWhatsApp: data.send_whatsapp,
        sendEmail: data.send_email,
      })
      results.push({
        receivable_id: r.id,
        ok: result.ok,
        reason: result.ok ? undefined : result.reason,
        message: result.ok ? undefined : result.message,
        sent_whatsapp: result.ok ? result.sent_whatsapp : undefined,
        sent_email: result.ok ? result.sent_email : undefined,
      })
    }

    // ARs solicitados mas nao encontrados/sem cobranca: marca como skipped
    const foundIds = new Set(receivables.map(r => r.id))
    for (const id of data.receivable_ids) {
      if (!foundIds.has(id)) {
        results.push({ receivable_id: id, ok: false, reason: 'no_charge', message: 'AR sem cobranca gerada ou nao encontrado' })
      }
    }

    const okCount = results.filter(r => r.ok).length
    const failCount = results.length - okCount

    logAudit({
      companyId: auth.companyId,
      userId: auth.id,
      module: 'financeiro',
      action: 'bulk_charge_resent',
      newValue: { requested: data.receivable_ids.length, ok: okCount, failed: failCount },
    })

    return NextResponse.json({
      data: {
        ok_count: okCount,
        fail_count: failCount,
        results,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}
