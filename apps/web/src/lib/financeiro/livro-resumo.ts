// Resumo do realizado no banco por categoria (livro-razão). Lógica pura, em centavos.
import { CATEGORIA_RECEITA_SERVICOS } from './livro-categorias'

export const CATEGORIAS_FORA_DO_TOTAL = ['Ajuste de caixa', 'Transferência entre contas', 'Transferência entre empresas']

type LinhaResumo = { transaction_type: string; amount: number; bank_ref: string | null; categoria: string | null }
type TotalCategoria = { categoria: string; total: number }

export function categoriaEfetiva(t: { transaction_type: string; bank_ref: string | null; categoria: string | null }): string {
  if (t.categoria) return t.categoria
  if (t.transaction_type === 'CREDIT') {
    const ref = t.bank_ref ?? ''
    if (ref.startsWith('AR:') || ref.startsWith('acquirer:') || ref.startsWith('pay_')) return CATEGORIA_RECEITA_SERVICOS
    return 'Receita a identificar'
  }
  return 'A classificar'
}

function somar(mapa: Map<string, number>): TotalCategoria[] {
  return [...mapa.entries()].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total)
}

// Totais são positivos (saídas = soma dos valores dos DEBIT). Fora do total: ajuste e transferências.
export function resumoRealizado(ts: LinhaResumo[]) {
  const entradas = new Map<string, number>()
  const saidas = new Map<string, number>()
  const fora = new Map<string, number>()
  for (const t of ts) {
    const cat = categoriaEfetiva(t)
    const alvo = CATEGORIAS_FORA_DO_TOTAL.includes(cat) ? fora : t.transaction_type === 'CREDIT' ? entradas : saidas
    alvo.set(cat, (alvo.get(cat) ?? 0) + Math.abs(t.amount))
  }
  const soma = (m: Map<string, number>) => [...m.values()].reduce((a, v) => a + v, 0)
  return {
    entradas: somar(entradas),
    saidas: somar(saidas),
    total_entradas: soma(entradas),
    total_saidas: soma(saidas),
    fora_do_total: somar(fora),
  }
}
