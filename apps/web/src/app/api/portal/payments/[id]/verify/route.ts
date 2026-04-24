import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { getPaymentProviderForAccount, getPaymentProvider } from '@/lib/payments/factory'

/**
 * POST /api/portal/payments/[id]/verify
 *
 * Fallback pra quando o webhook Asaas nao chegou (caso comum: webhook
 * desconfigurado, rede instavel, sessao Asaas resetou). Cliente clica
 * "Ja paguei?" no modal e esta rota consulta o Asaas ATIVAMENTE via
 * GET /payments/{externalId}. Se Asaas disser RECEIVED/CONFIRMED:
 *   1. Atualiza Payment.status + paid_at
 *   2. Faz baixa no AccountReceivable vinculado (se tiver)
 *   3. Retorna is_paid=true pra UI atualizar sem precisar esperar webhook
 *
 * NAO substitui o webhook — complementa. Webhook continua sendo o
 * canal principal; esta rota e resgate.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

    const payment = await prisma.payment.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
      },
    })
    if (!payment) return NextResponse.json({ error: 'Pagamento nao encontrado' }, { status: 404 })
    if (!payment.external_id) return NextResponse.json({ error: 'Pagamento sem ID externo' }, { status: 400 })

    // Ja esta confirmado localmente? retorna cedo
    if (payment.status === 'RECEIVED' || payment.status === 'CONFIRMED') {
      return NextResponse.json({
        data: { id: payment.id, status: payment.status, is_paid: true, source: 'local' },
      })
    }

    // Resolve provider — via account_id do metadata se tiver
    const accountId = (payment.metadata as Record<string, string>)?.account_id
    const provider = accountId
      ? await getPaymentProviderForAccount(accountId, portalUser.company_id)
      : getPaymentProvider()
    if (!provider) return NextResponse.json({ error: 'Provider indisponivel' }, { status: 503 })

    // Consulta Asaas direto
    const remote = await provider.getStatus(payment.external_id)

    // Mapeia status remoto → interno (mesma tabela do webhook)
    const REMOTE_TO_INTERNAL: Record<string, string> = {
      PENDING: 'PENDING',
      CONFIRMED: 'CONFIRMED',
      EXPIRED: 'EXPIRED',
      REFUNDED: 'REFUNDED',
      FAILED: 'FAILED',
    }
    const newStatus = REMOTE_TO_INTERNAL[remote.status] || payment.status

    // Se Asaas ainda diz PENDING, so retorna (nao atualiza)
    if (newStatus === 'PENDING' && payment.status === 'PENDING') {
      return NextResponse.json({
        data: { id: payment.id, status: 'PENDING', is_paid: false, source: 'asaas' },
      })
    }

    // Se esta como CONFIRMED/RECEIVED, grava e faz baixa
    const isPaid = newStatus === 'CONFIRMED' || newStatus === 'RECEIVED' || remote.status === 'CONFIRMED'

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: isPaid ? 'CONFIRMED' : newStatus,
          paid_at: isPaid ? (remote.paidAt || new Date()) : null,
          updated_at: new Date(),
        },
      })

      // Baixa no AR se vinculado
      if (isPaid && payment.receivable_id) {
        const ar = await tx.accountReceivable.findFirst({
          where: { id: payment.receivable_id, company_id: payment.company_id },
        })
        if (ar && ar.status !== 'RECEBIDO') {
          const newReceived = (ar.received_amount || 0) + payment.amount
          const fullyPaid = newReceived >= ar.total_amount
          await tx.accountReceivable.update({
            where: { id: ar.id },
            data: {
              received_amount: newReceived,
              status: fullyPaid ? 'RECEBIDO' : 'PENDENTE',
              charge_status: 'CONFIRMED',
              payment_method: payment.billing_type || payment.method || ar.payment_method,
            },
          })
        }
      }

      // Log (util pra auditoria)
      await tx.webhookLog.create({
        data: {
          company_id: payment.company_id,
          event: 'MANUAL_VERIFY',
          payment_id: payment.id,
          payload: { triggered_by: 'portal', remote_status: remote.status } as any,
          status: isPaid ? 'PROCESSED' : 'IGNORED',
        },
      }).catch(() => {})
    })

    return NextResponse.json({
      data: {
        id: payment.id,
        status: isPaid ? 'CONFIRMED' : newStatus,
        is_paid: isPaid,
        source: 'asaas',
      },
    })
  } catch (err) {
    console.error('[Portal Payment Verify]', err)
    const msg = err instanceof Error ? err.message : 'Erro ao verificar'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
