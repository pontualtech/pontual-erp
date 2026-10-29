// Regras puras do webhook Asaas sobre a conta a receber (usadas por app/api/webhooks/payment).
// Karlão 29/10: "liquidar quando cair o dinheiro"; "no Asaas o dinheiro fica na própria conta Asaas";
// e o financeiro precisa saber quanto entrou de fato (líquido) e quanto foi de taxa.
//   CONFIRMED = cliente pagou (cartão autorizado / boleto compensado), dinheiro ainda NÃO disponível → RECEBIDO, sem conciliar.
//   RECEIVED  = dinheiro creditado na conta Asaas → LIQUIDADO + conciliado; crédito do LÍQUIDO na data do crédito.

interface ArAtual {
  status: string | null
  received_amount: number | null
  total_amount: number
}

const QUITADA = ['RECEBIDO', 'LIQUIDADO', 'PAGO']

/** Campos da AR no CONFIRMED; null = não mexer (já quitada). */
export function estadoArConfirmado(ar: ArAtual, amount: number) {
  if (QUITADA.includes(ar.status || '')) return null
  const received = (ar.received_amount || 0) + amount
  return { received_amount: received, status: received >= ar.total_amount ? 'RECEBIDO' : 'PENDENTE' }
}

/** Campos da AR no RECEIVED: quitada → LIQUIDADO + conciliado (sem somar de novo se o CONFIRMED já somou). */
export function estadoArRecebido(ar: ArAtual, amount: number) {
  if (QUITADA.includes(ar.status || '')) return { status: 'LIQUIDADO', reconciled: true }
  const received = (ar.received_amount || 0) + amount
  return received >= ar.total_amount
    ? { received_amount: received, status: 'LIQUIDADO', reconciled: true }
    : { received_amount: received, status: 'PENDENTE' }
}

/** Valor (centavos) que entra no saldo da conta Asaas: o líquido do Asaas; sem líquido coerente, o bruto. */
export function valorCreditoAsaas(asaasPayment: { netValue?: unknown; [campo: string]: unknown }, grossCents: number): number {
  const net = Number(asaasPayment.netValue)
  const netCents = Math.round(net * 100)
  return Number.isFinite(net) && netCents > 0 && netCents <= grossCents ? netCents : grossCents
}

/** Data em que o dinheiro ficou disponível (creditDate > paymentDate), ao meio-dia de Brasília; null se não houver. */
export function dataCreditoAsaas(asaasPayment: { creditDate?: unknown; paymentDate?: unknown; [campo: string]: unknown }): Date | null {
  for (const v of [asaasPayment.creditDate, asaasPayment.paymentDate]) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      const d = new Date(`${v.slice(0, 10)}T12:00:00-03:00`)
      if (!Number.isNaN(d.getTime())) return d
    }
  }
  return null
}
