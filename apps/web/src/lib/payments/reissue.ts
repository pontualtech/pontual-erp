/**
 * Reemissão de cobrança (05/10/2026, caso OS 62122).
 *
 * Payment.idempotency_key é UNIQUE e determinística por AR/OS — quando o
 * boleto é cancelado/apagado no Asaas, o registro antigo continuava
 * bloqueando qualquer nova emissão ("Ja existe uma cobranca"), sem olhar o
 * status. Um payment em estado TERMINAL NÃO-PAGO não deve bloquear: a key
 * dele é arquivada (padrão archived_ do portal) e a cobrança sai de novo.
 *
 * OVERDUE fica de fora de propósito: boleto vencido ainda é pagável no
 * Asaas — reemitir sem cancelar criaria risco de pagamento duplo. O fluxo
 * é cancelar no Asaas (vira DELETED/CANCELLED) e então reemitir.
 */
const REISSUABLE_STATUSES = new Set(['DELETED', 'CANCELLED', 'CANCELADO', 'EXPIRED', 'REFUNDED'])

export function isReissuablePaymentStatus(status: string | null | undefined): boolean {
  return !!status && REISSUABLE_STATUSES.has(status)
}
