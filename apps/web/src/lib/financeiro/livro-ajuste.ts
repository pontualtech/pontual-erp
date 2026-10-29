// Ajuste de caixa do Livro-razão (puro): diferença entre o saldo real do banco e o saldo do ERP.

export function calcularAjuste(
  saldoRealCentavos: number,
  saldoErpCentavos: number,
): { tipo: 'CREDIT' | 'DEBIT' | null; amount: number } {
  const diff = saldoRealCentavos - saldoErpCentavos
  if (diff === 0) return { tipo: null, amount: 0 }
  return { tipo: diff > 0 ? 'CREDIT' : 'DEBIT', amount: Math.abs(diff) }
}
