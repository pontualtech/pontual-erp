import { prisma } from '@pontual/db'
import { TERMINAL_RECEIVABLE_STATUSES } from '@/lib/finance/receivable-status'

/**
 * findActivePendingPaymentForOs — busca a Payment PENDING mais recente
 * de uma OS (independente do método ou canal de criação).
 *
 * Caso de uso: regra de dominio "1 OS = 1 Payment PENDING max". Todos os
 * endpoints que criam cobrança (dashboard /os/[id]/charge + portal pix/
 * boleto/credit-card) precisam checar isso ANTES de chamar provider.
 *
 * Retorna:
 *  - null: OS nao tem cobranca ativa, pode criar livremente
 *  - { payment, expired: false }: tem cobranca ativa nao-expirada
 *  - { payment, expired: true }: tem cobranca ativa mas expirada (PIX 30min
 *    ou Boleto due_date passou) — caller pode cancelar+recriar
 *
 * "Expirado" so se aplica a PIX (expires_at) e Boleto (vencimento ja passou).
 * Cartao nao tem TTL: cliente abre invoice_url quando quiser.
 */
export interface ActiveChargeInfo {
  payment: {
    id: string
    status: string
    method: string | null
    billing_type: string | null
    amount: number
    invoice_url: string | null
    bank_slip_url: string | null
    qr_code: string | null
    qr_code_image: string | null
    expires_at: Date | null
    external_id: string | null
    receivable_id: string | null
    created_at: Date | null
  }
  expired: boolean
}

export async function findActivePendingPaymentForOs(
  osId: string,
  companyId: string,
): Promise<ActiveChargeInfo | null> {
  const payment = await prisma.payment.findFirst({
    where: {
      service_order_id: osId,
      company_id: companyId,
      status: 'PENDING',
    },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      status: true,
      method: true,
      billing_type: true,
      amount: true,
      invoice_url: true,
      bank_slip_url: true,
      qr_code: true,
      qr_code_image: true,
      expires_at: true,
      external_id: true,
      receivable_id: true,
      created_at: true,
    },
  })

  if (!payment) return null

  // Expiração:
  //   PIX: expires_at (30min)
  //   Boleto: due_date do AR vinculado (apos 30 dias do vencimento)
  // A15 fix 22/05: antes boleto vencido bloqueava nova cobranca eternamente
  // — cliente ficava preso, atendente forcado a cancelar manualmente.
  // Agora apos 30 dias do vencimento, considera expired e libera nova
  // cobranca (PIX/cartao). Boleto recente ainda continua valido pra pagamento.
  const now = new Date()
  let expired = payment.method === 'PIX' && !!payment.expires_at && payment.expires_at < now
  if (!expired && payment.method === 'BOLETO' && payment.receivable_id) {
    const ar = await prisma.accountReceivable.findFirst({
      where: { id: payment.receivable_id },
      select: { due_date: true },
    })
    if (ar?.due_date) {
      const cutoff = new Date(ar.due_date)
      cutoff.setDate(cutoff.getDate() + 30)
      if (cutoff < now) expired = true
    }
  }

  return { payment, expired }
}

/**
 * isOsAlreadyPaid — verifica se a OS ja foi paga. Considera 2 sinais:
 *  1. AccountReceivable com status RECEBIDO (cobranca quitada)
 *  2. Payment com status CONFIRMED ou RECEIVED (pagamento autorizado/recebido)
 *
 * Usado pelos 4 endpoints de cobranca pra BLOQUEAR criacao de nova cobranca
 * em OS ja paga (caso real Karlao OS 60475: cartao pagou, AR ficou PENDENTE
 * porque webhook so baixava no RECEIVED, sistema permitia nova cobranca).
 */
export async function isOsAlreadyPaid(osId: string, companyId: string): Promise<boolean> {
  const receivedAR = await prisma.accountReceivable.findFirst({
    where: {
      service_order_id: osId,
      company_id: companyId,
      // auditoria 27/06: inclui LIQUIDADO (extrato conferido via bulk-reconcile)
      // e PAGO (legado) — antes só 'RECEBIDO' deixava o portal gerar nova
      // cobrança (PIX/boleto real) em OS já paga na entrega/balcão.
      status: { in: [...TERMINAL_RECEIVABLE_STATUSES] },
      deleted_at: null,
    },
    select: { id: true },
  })
  if (receivedAR) return true

  const paidPayment = await prisma.payment.findFirst({
    where: {
      service_order_id: osId,
      company_id: companyId,
      status: { in: ['CONFIRMED', 'RECEIVED'] },
    },
    select: { id: true },
  })
  return !!paidPayment
}
