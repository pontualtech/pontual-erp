import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { getPaymentProviderForAccount, getPaymentProvider } from '@/lib/payments/factory'
import { isImprimitechHandoffStatus } from '@/lib/imprimitech-handoff'
import { isReceivableSettled } from '@/lib/finance/receivable-status'
import { conflitoDeBanco } from '@/lib/financeiro/livro-baixa-db'
import { logError } from '@/lib/observability'

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
      include: {
        service_orders: { select: { module_statuses: { select: { name: true } } } },
      },
    })
    if (!payment) return NextResponse.json({ error: 'Pagamento nao encontrado' }, { status: 404 })
    if (!payment.external_id) return NextResponse.json({ error: 'Pagamento sem ID externo' }, { status: 400 })

    // Wave 1.2 audit Hi11: gate handoff Imprimitech — verify NÃO pode confirmar
    // pagamento + baixar AR de OS já transferida (criaria divergência financeira
    // PT vs IMP). Mesmo padrão dos endpoints geradores de cobrança.
    if (isImprimitechHandoffStatus(payment.service_orders?.module_statuses?.name)) {
      return NextResponse.json({ error: 'Pagamento nao encontrado' }, { status: 404 })
    }

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

    // Mapeia status remoto → interno (mesma tabela do webhook).
    // Audit 14 fix: RECEIVED estava faltando — Asaas envia RECEIVED quando
    // boleto/PIX e pago e CONFIRMED quando cartao auth. Sem map, status
    // RECEIVED caia em fallback (payment.status original = PENDING) e
    // is_paid ficava false mesmo com pagamento confirmado no Asaas.
    const REMOTE_TO_INTERNAL: Record<string, string> = {
      PENDING: 'PENDING',
      RECEIVED: 'CONFIRMED',
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

    // Fix 6 (F6-E, #8): o webhook RECEIVED pode comitar entre a leitura de cima e esta gravação. Trava a AR (FOR UPDATE)
    // e relê Payment e AR: o Payment nunca regride (RECEIVED não volta a CONFIRMED; já no status remoto não regrava) e a
    // AR só soma o pagamento se o Payment relido ainda não estava pago e a AR relida não está quitada.
    // Fix 7 (F7-F, #9/#17/m9): a ordem das travas é a do webhook — Payment (FOR UPDATE) e depois a AR; na ordem inversa
    // as duas tx se esperavam (deadlock). O verify não cria crédito, então não trava conta.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id} AND company_id = ${payment.company_id} FOR UPDATE`
      const relido = await tx.payment.findFirst({ where: { id: payment.id, company_id: payment.company_id } })
      if (payment.receivable_id) {
        await tx.$queryRaw`SELECT id FROM accounts_receivable WHERE id = ${payment.receivable_id} AND company_id = ${payment.company_id} FOR UPDATE`
      }
      if (!relido) return
      const statusNovo = isPaid ? 'CONFIRMED' : newStatus
      const jaPago = relido.status === 'RECEIVED' || relido.status === 'CONFIRMED'
      if (!jaPago && relido.status !== statusNovo) {
        await tx.payment.updateMany({
          where: { id: payment.id, status: relido.status },
          data: {
            status: statusNovo,
            paid_at: isPaid ? (remote.paidAt || new Date()) : null,
            updated_at: new Date(),
          },
        })
      }

      // Baixa no AR se vinculado
      if (isPaid && !jaPago && payment.receivable_id) {
        const ar = await tx.accountReceivable.findFirst({
          where: { id: payment.receivable_id, company_id: payment.company_id },
        })
        if (ar && !isReceivableSettled(ar)) {
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
    }, { maxWait: 10000, timeout: 20000 })

    return NextResponse.json({
      data: {
        id: payment.id,
        status: isPaid ? 'CONFIRMED' : newStatus,
        is_paid: isPaid,
        source: 'asaas',
      },
    })
  } catch (err) {
    // Fix 7 (F7-F): conflito com o webhook (deadlock/espera de trava) → 409 amigável; qualquer outro erro → mensagem
    // genérica + log — nunca o texto do banco/Prisma para o cliente.
    if (conflitoDeBanco(err)) {
      return NextResponse.json({ error: 'Estamos confirmando seu pagamento; tente de novo em instantes.' }, { status: 409 })
    }
    console.error('[Portal Payment Verify]', err)
    void logError(err, { url: '/api/portal/payments/[id]/verify', method: 'POST', params: { payment: params.id } })
    return NextResponse.json({ error: 'Não foi possível verificar o pagamento agora; tente de novo em instantes.' }, { status: 500 })
  }
}
