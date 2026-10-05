/**
 * Regras de "cobrança ativa" (05/10/2026, caso duplicatas OS 62482/61197).
 *
 * O webhook do Asaas muda Payment PENDING → OVERDUE no vencimento, e os
 * guards de duplicidade buscavam só PENDING: o boleto vencido (AINDA
 * PAGÁVEL no Asaas) ficava invisível e o sistema deixava criar uma 2ª
 * cobrança ativa pro mesmo débito — risco de pagamento duplo.
 *
 * Ativa = PENDING ou OVERDUE. A regra de expiração (A15) decide quando uma
 * cobrança ativa deixa de bloquear: PIX pelo expires_at; BOLETO (e qualquer
 * método que o Asaas marcou OVERDUE) libera 30 dias após o vencimento do AR,
 * pra não prender o cliente eternamente num link velho.
 */
export const ACTIVE_CHARGE_STATUSES = ['PENDING', 'OVERDUE'] as const

const EXPIRA_APOS_VENCIDO_DIAS = 30

export function computeChargeExpired(
  payment: { method: string | null; status: string; expires_at: Date | null },
  arDueDate: Date | null,
  now: Date,
): boolean {
  if (payment.method === 'PIX' && payment.expires_at && payment.expires_at < now) return true
  if ((payment.method === 'BOLETO' || payment.status === 'OVERDUE') && arDueDate) {
    const cutoff = new Date(arDueDate)
    cutoff.setDate(cutoff.getDate() + EXPIRA_APOS_VENCIDO_DIAS)
    if (cutoff < now) return true
  }
  return false
}
