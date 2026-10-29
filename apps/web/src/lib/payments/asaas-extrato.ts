// Liga cada lançamento do extrato da conta Asaas (/financialTransactions) à cobrança/OS do ERP — base do
// "de onde veio cada real" (Karlão 29/10: "quero saber tudo que entra de dinheiro na empresa de forma clara").

export interface LancamentoAsaas {
  date?: string
  type?: string
  value?: number
  description?: string
  paymentId?: string | null
}

export interface PagamentoErp {
  external_id: string
  os_number: number | null
  ar_status: string | null
  ar_reconciled: boolean | null
}

export function resumirExtratoAsaas(lancamentos: LancamentoAsaas[], pagamentos: PagamentoErp[]) {
  const porId = new Map(pagamentos.map(p => [p.external_id, p]))
  return lancamentos.map(l => {
    const valor = Math.round(Number(l.value || 0) * 100)
    const p = l.paymentId ? porId.get(l.paymentId) : undefined
    let alerta: string | null = null
    if (valor > 0 && l.paymentId && !p) alerta = 'entrada sem cobrança no ERP'
    else if (valor > 0 && p && !(p.ar_reconciled && ['LIQUIDADO', 'RECEBIDO', 'PAGO'].includes(p.ar_status || ''))) alerta = 'dinheiro entrou mas a conta a receber não está conciliada'
    return {
      data: l.date || null,
      tipo: l.type || null,
      valor_centavos: valor,
      descricao: l.description || null,
      payment_id: l.paymentId || null,
      os: p?.os_number ?? null,
      ar_status: p?.ar_status ?? null,
      conciliado: p?.ar_reconciled ?? null,
      alerta,
    }
  })
}
