import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { getPaymentProviderForAccount, getPaymentProvider } from '@/lib/payments/factory'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/admin/payments/reconcile
 *
 * Reconciliacao manual de pagamentos quando webhook do Asaas nao chega
 * (problema de infra/config). Consulta status real direto no Asaas e faz
 * baixa nos AR pagos. Resolve casos silenciosos onde cliente pagou mas
 * sistema nao foi notificado.
 *
 * Body:
 *   { payment_id: string }              → reconcilia 1 pagamento especifico
 *   { reconcile_all_pending: true,      → reconcilia todos PENDING dos
 *     days?: number (default 30) }         ultimos N dias da empresa
 *
 * Permission: financeiro.edit
 *
 * Response:
 *   { processed: number, paid: number, still_pending: number, errors: number,
 *     details: Array<{ id, os_number, asaas_status, action, reason }> }
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const { payment_id, reconcile_all_pending, days } = body

    let payments: Array<{ id: string; external_id: string | null; amount: number; status: string; receivable_id: string | null; service_order_id: string | null; company_id: string; method: string | null; billing_type: string | null; metadata: any }> = []

    if (payment_id) {
      const p = await prisma.payment.findFirst({
        where: { id: payment_id, company_id: user.companyId },
      })
      if (!p) return error('Pagamento nao encontrado', 404)
      payments = [p as any]
    } else if (reconcile_all_pending) {
      const sinceDays = Math.max(1, Math.min(90, parseInt(String(days || '30'))))
      const since = new Date()
      since.setDate(since.getDate() - sinceDays)
      const list = await prisma.payment.findMany({
        where: {
          company_id: user.companyId,
          status: 'PENDING',
          created_at: { gte: since },
          external_id: { not: null },
        },
        orderBy: { created_at: 'desc' },
        take: 200, // safety
      })
      payments = list as any[]
    } else {
      return error('Informe payment_id ou reconcile_all_pending=true', 400)
    }

    const details: any[] = []
    let paid = 0, stillPending = 0, errors = 0

    for (const p of payments) {
      try {
        const accountId = (p.metadata as Record<string, string> | null)?.account_id
        const provider = accountId
          ? await getPaymentProviderForAccount(accountId, p.company_id)
          : getPaymentProvider()
        if (!provider) {
          errors++
          details.push({ id: p.id, action: 'skip', reason: 'provider indisponivel' })
          continue
        }

        if (!p.external_id) {
          errors++
          details.push({ id: p.id, action: 'skip', reason: 'sem external_id' })
          continue
        }

        const remote = await provider.getStatus(p.external_id)
        const isPaid = remote.status === 'CONFIRMED'

        if (!isPaid) {
          stillPending++
          details.push({ id: p.id, action: 'still_pending', asaas_status: remote.status })
          continue
        }

        // Pago — reconcilia
        await prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { id: p.id },
            data: { status: 'RECEIVED', paid_at: remote.paidAt || new Date() },
          })

          if (p.receivable_id) {
            const ar = await tx.accountReceivable.findFirst({ where: { id: p.receivable_id } })
            if (ar && ar.status !== 'RECEBIDO') {
              const newReceived = (ar.received_amount || 0) + p.amount
              const fully = newReceived >= ar.total_amount
              await tx.accountReceivable.update({
                where: { id: ar.id },
                data: {
                  received_amount: newReceived,
                  status: fully ? 'RECEBIDO' : 'PENDENTE',
                  charge_status: 'RECEIVED',
                  payment_method: p.billing_type || p.method || ar.payment_method,
                },
              })

              // Append nas obs internas da OS — mesmo formato do webhook
              if (p.service_order_id) {
                const so = await tx.serviceOrder.findUnique({
                  where: { id: p.service_order_id },
                  select: { internal_notes: true, os_number: true },
                })
                const valorBRL = (p.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                const dataStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                const metodo = p.billing_type || p.method || 'PIX'
                const novaNota = `[${dataStr}] ✓ Pagamento confirmado (reconciliacao manual): ${metodo} ${valorBRL} — Asaas ${p.external_id}`
                const notesAtual = so?.internal_notes ? so.internal_notes + '\n' : ''
                await tx.serviceOrder.update({
                  where: { id: p.service_order_id },
                  data: { internal_notes: notesAtual + novaNota },
                })
                details.push({ id: p.id, os_number: so?.os_number, action: 'reconciled', amount: p.amount })
              } else {
                details.push({ id: p.id, action: 'reconciled', amount: p.amount })
              }
            } else {
              details.push({ id: p.id, action: 'ar_already_paid' })
            }
          }

          await tx.webhookLog.create({
            data: {
              company_id: p.company_id,
              event: 'MANUAL_RECONCILE',
              payment_id: p.id,
              payload: { triggered_by: user.id, asaas_status: remote.status },
              status: 'PROCESSED',
            },
          })
        })

        paid++
      } catch (e) {
        errors++
        const msg = e instanceof Error ? e.message : 'erro'
        details.push({ id: p.id, action: 'error', reason: msg })
        console.error('[Reconcile] payment', p.id, msg)
      }
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payment_reconcile',
      newValue: { processed: payments.length, paid, still_pending: stillPending, errors },
    })

    return success({
      processed: payments.length,
      paid,
      still_pending: stillPending,
      errors,
      details,
    })
  } catch (err) {
    return handleError(err)
  }
}
