// Ajuste de caixa do Livro-razão (puro): diferença entre o saldo real do banco e o saldo do ERP.

export function calcularAjuste(
  saldoRealCentavos: number,
  saldoErpCentavos: number,
): { tipo: 'CREDIT' | 'DEBIT' | null; amount: number } {
  const diff = saldoRealCentavos - saldoErpCentavos
  if (diff === 0) return { tipo: null, amount: 0 }
  return { tipo: diff > 0 ? 'CREDIT' : 'DEBIT', amount: Math.abs(diff) }
}

// Data AAAA-MM-DD existente no calendário (rejeita 2026-02-31, que o Date normalizaria para março).
export function dataValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00.000Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
