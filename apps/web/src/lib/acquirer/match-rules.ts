// Regras puras do casamento venda da maquininha × conta a receber (usadas por perform-match e bulk-reconcile).
// Karlão 29/10: venda confirmada pela Rede → AR LIQUIDADO no dia em que o dinheiro entra no banco;
// e "não pode ser lançado a taxa em dobro" (estimativa da entrega × taxa real da Rede).
import { isReceivableSettled } from '@/lib/finance/receivable-status'

interface ArAtual {
  status: string | null
  reconciled: boolean | null
  received_amount: number | null
  total_amount: number
}

/**
 * Campos a gravar na AR ao casar uma venda. `bancoConfirmou` = o crédito da venda foi visto no extrato
 * (a rotina da manhã passa credit_date); sem isso mantém o comportamento antigo (RECEBIDO, só concilia).
 */
export function novoEstadoReceivable(ar: ArAtual, grossAmount: number, billingType: string, bancoConfirmou: boolean) {
  if (isReceivableSettled(ar)) {
    return bancoConfirmou
      ? { status: 'LIQUIDADO', reconciled: true, charge_status: 'RECEIVED' }
      : { reconciled: true, charge_status: 'RECEIVED' }
  }
  const received = (ar.received_amount || 0) + grossAmount
  const fully = received >= ar.total_amount
  return {
    received_amount: received,
    status: fully ? (bancoConfirmou ? 'LIQUIDADO' : 'RECEBIDO') : 'PARCIAL',
    charge_status: 'RECEIVED',
    payment_method: billingType,
    ...(fully ? { reconciled: true } : {}),
  }
}

/** Taxa ESTIMADA criada na entrega (os/[id]/transition e driver/stop/[id]/entrega): "Taxa cartão OS-0000 — ...". */
export function ehTaxaEstimadaDaOS(description: string | null | undefined, osNumber: number): boolean {
  const osNum = String(osNumber).padStart(4, '0')
  return new RegExp(`^taxa cart[aã]o OS-${osNum}(?!\\d)`, 'i').test(description || '')
}

/**
 * Recebe as APs ativas que citam a OS e decide: cancelar as estimadas PENDENTES e lançar a taxa real;
 * se uma estimada já foi dada como PAGA, não lança a real (seria a taxa em dobro).
 */
export function planoTaxas(aps: { id: string; description: string | null; status: string | null }[], osNumber: number) {
  const estimadas = aps.filter(a => ehTaxaEstimadaDaOS(a.description, osNumber))
  if (estimadas.some(a => a.status === 'PAGO')) return { cancelar: [] as string[], lancarReal: false }
  return { cancelar: estimadas.filter(a => a.status === 'PENDENTE').map(a => a.id), lancarReal: true }
}

/**
 * bank_ref dos créditos que já entraram no saldo para os pagamentos da AR: performMatch da maquininha grava
 * `acquirer:<provider>:<NSU>`; o webhook Asaas grava o próprio id do pagamento (pay_xxx).
 */
export function refsCreditoAdquirente(payments: { provider: string | null; external_id: string | null }[]): string[] {
  return payments.filter(p => p.external_id && (p.provider === 'asaas' || p.provider === 'rede'))
    .map(p => (p.provider === 'asaas' ? p.external_id! : `acquirer:${p.provider}:${p.external_id}`))
}
