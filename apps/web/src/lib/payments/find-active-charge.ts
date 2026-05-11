import { prisma } from '@pontual/db'

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

  // Expiração: PIX usa expires_at (30min). Boleto: due_date no AR vinculado
  // (mas ler isso requer outra query). Por simplicidade, "expired" so true
  // se PIX tem expires_at no passado. Boleto vencido continua valido (Asaas
  // aceita pagamento pos-vencimento — atendente cancela manualmente se
  // quiser nova).
  const now = new Date()
  const expired = payment.method === 'PIX' && !!payment.expires_at && payment.expires_at < now

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
      status: 'RECEBIDO',
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
