import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getPaymentProviderForAccount } from '@/lib/payments/factory'

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
      },
    })

    return NextResponse.json({
      success: true,
      payment_id: payment.id,
      provider_cancelled: providerCancelled,
      ...(providerError && { provider_warning: 'Cancelamento local feito, mas provider falhou — verifique manualmente no Asaas se a cobranca foi removida.' }),
    })
  } catch (err) {
    console.error('[OS Charge Cancel] Error:', err)
    const msg = err instanceof Error ? err.message : 'Erro ao cancelar cobranca'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
