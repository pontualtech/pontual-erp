/**
 * Regras de quando o cliente pode pagar uma OS pelo portal.
 *
 * O botao "Pagar agora" no portal so aparece quando o cliente JA aprovou
 * o reparo (status Aprovado em diante). Antes disso, gerar PIX/Boleto
 * gera confusao porque:
 *  - O orcamento ainda pode mudar (recalculo, negociacao, recusa)
 *  - Cliente pode pagar achando que e o orcamento final
 *  - PIX expirado/duplicado polui o financeiro
 *
 * Status que LIBERAM pagamento:
 *  - Aprovado / Aprovada       (cliente concordou com o orcamento)
 *  - Em Execucao               (reparo em andamento)
 *  - Aguardando Peca / Peça   (reparo pausado por peca)
 *  - Entregar Reparado         (pronto pra retirada/entrega)
 *  - Entregue                  (motorista entregou — cliente pode pagar depois)
 *
 * NAO liberam: Coletar, Orcar, LAUDO, Negociar, Aguardando Aprovacao,
 * Cancelada, Recusado.
 *
 * Atencao: este helper so decide se o botao APARECE. Se o AR ja esta
 * RECEBIDO, o componente PortalPayBox mostra "Pagamento confirmado"
 * via /api/portal/os/[id]/pay-status independentemente do status.
 */
const ALLOWED_PATTERN = /^(aprovad|em execu|aguardando pe[çc]a|entregar reparad|entregue)/i

export function canCustomerPayOS(statusName: string | null | undefined): boolean {
  if (!statusName) return false
  return ALLOWED_PATTERN.test(statusName.trim())
}

export const PAYMENT_BLOCKED_MESSAGE =
  'Pagamento liberado apos a aprovacao do reparo. Aguarde o orcamento ou aprove para liberar PIX/Boleto.'
