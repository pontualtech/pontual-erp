/**
 * Regras de quando o cliente pode pagar uma OS pelo portal.
 *
 * Decisao Karlao 2026-05-07: o botao "Pagar agora" no portal so aparece
 * quando o equipamento estiver pronto pra entrega/retirada (status
 * Entregar Reparado) ou ja foi entregue (status Entregue). Antes disso
 * gera confusao porque:
 *  - Equipamento ainda nao esta disponivel pra entregar
 *  - Cliente pode pagar e ficar esperando dias ate o reparo terminar
 *  - PIX expirado/duplicado polui o financeiro
 *
 * Status INTERNOS (do banco) que liberam pagamento:
 *  - Entregar Reparado         (pronto pra retirada/entrega)
 *  - Entregue                  (motorista entregou — cliente pode pagar depois)
 *
 * NAO liberam: Coletar, Orcar, LAUDO, Aguardando Aprovacao, Aprovado,
 * Em Execucao, Aguardando Peca, Negociar, Cancelada, Recusado, Em Analise.
 *
 * Atencao: este helper so decide se o botao APARECE. Se o AR ja esta
 * RECEBIDO, o componente PortalPayBox mostra "Pagamento confirmado"
 * via /api/portal/os/[id]/pay-status independentemente do status.
 *
 * Onde e usado:
 *  - /api/portal/os/[id]   → computa can_pay no DTO (frontend so consome)
 *  - /api/portal/payments/pix     → valida antes de gerar PIX
 *  - /api/portal/payments/boleto  → valida antes de gerar boleto
 *
 * Os 3 lugares recebem o nome INTERNO direto do banco — nao precisa
 * cobrir labels mapeados do portal (Em Reparo, Pronto para Retirada).
 */
const ALLOWED_PATTERN = /^(entregar reparad|entregue)/i

export function canCustomerPayOS(statusName: string | null | undefined): boolean {
  if (!statusName) return false
  return ALLOWED_PATTERN.test(statusName.trim())
}

export const PAYMENT_BLOCKED_MESSAGE =
  'Pagamento liberado quando o equipamento estiver pronto para entrega/retirada.'
