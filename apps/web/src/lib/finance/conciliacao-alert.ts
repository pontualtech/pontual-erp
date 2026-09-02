/**
 * Classifica um recebível para o alerta semanal de conciliação pendente.
 *
 * Contexto (auditoria 01/09, golpe do comprovante OS 61857): recebíveis
 * DECLARADOS recebidos na entrega/balcão mas nunca conciliados no extrato
 * ficam "pagos" no sistema sem lastro. Este controle detective alerta o
 * financeiro semanalmente pra ninguém mais acumular declaração não conferida.
 *
 * Campos nullable de propósito: as colunas vêm do schema legado (vhsys) e o
 * tipo Prisma é `X | null` mesmo quando o WHERE filtra — o helper tolera null
 * (vira 'skip') em vez de forçar cast no chamador.
 *
 * - 'skip'  — não se qualifica (não declarado, conciliado, sem valor, novo,
 *             deletado) OU já tem pagamento confirmado no provedor (lastro real).
 * - 'high'  — PIX/boleto/transferência declarado, sem lastro de provedor: é o
 *             formato do golpe do comprovante (comprovante em PDF não garante
 *             que o dinheiro caiu). Conferir extrato com prioridade.
 * - 'watch' — cartão/dinheiro/outro declarado sem conciliar: normal, mas ainda
 *             pendente de conferência (Rede / caixa).
 */
export type AlertLevel = 'skip' | 'watch' | 'high'

const DECLARED_STATUSES = ['RECEBIDO', 'LIQUIDADO', 'PAGO']

export function receivableAlertLevel(
  ar: {
    status: string | null
    reconciled: boolean | null
    received_amount: number | null
    deleted_at: Date | null
    created_at: Date | null
    payment_method: string | null
  },
  hasProviderPayment: boolean,
  nowMs: number,
  minAgeDays = 7,
): AlertLevel {
  if (ar.deleted_at) return 'skip'
  if (!ar.status || !DECLARED_STATUSES.includes(ar.status)) return 'skip'
  if (ar.reconciled) return 'skip'
  if ((ar.received_amount || 0) <= 0) return 'skip'
  if (!ar.created_at) return 'skip'
  const ageDays = (nowMs - ar.created_at.getTime()) / 86_400_000
  if (ageDays < minAgeDays) return 'skip'
  // Pagamento confirmado pelo provedor (Asaas) = lastro real, não alerta.
  if (hasProviderPayment) return 'skip'
  const m = (ar.payment_method || '').toLowerCase()
  const comprovanteRisk = m.includes('pix') || m.includes('boleto') || m.includes('transfer')
  return comprovanteRisk ? 'high' : 'watch'
}
