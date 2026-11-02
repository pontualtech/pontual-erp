// Resumo do realizado no banco por categoria (livro-razão). Lógica pura, em centavos.
import { CATEGORIA_RECEITA_SERVICOS, CATEGORIAS_FORA_DO_TOTAL } from './livro-categorias'

export { CATEGORIAS_FORA_DO_TOTAL }

type LinhaResumo = { transaction_type: string; amount: number; bank_ref: string | null; linked_ref?: string | null; categoria: string | null }
type TotalCategoria = { categoria: string; total: number }

export function categoriaEfetiva(t: { transaction_type: string; bank_ref: string | null; linked_ref?: string | null; categoria: string | null }): string {
  if (t.categoria) return t.categoria
  const ref = t.bank_ref ?? ''
  // Onda 4 (fix 1.3): na linha do banco convertida de um nocional, a ref antiga está no linked_ref.
  const antiga = t.linked_ref ?? ''
  // Sem categoria: estorno (AR:x:estorno / AP:x:estorno) e transferência não são receita nem despesa.
  if (ref.endsWith(':estorno') || antiga.endsWith(':estorno')) return 'Estornos'
  if (ref.startsWith('TRANSFER:') || antiga.startsWith('TRANSFER:')) return 'Transferência entre contas'
  if (t.transaction_type === 'CREDIT') {
    if (ref.startsWith('AR:') || ref.startsWith('acquirer:') || ref.startsWith('pay_')) return CATEGORIA_RECEITA_SERVICOS
    if (['AR:', 'acquirer:', 'pay_', 'cnab:'].some((p) => antiga.startsWith(p))) return CATEGORIA_RECEITA_SERVICOS
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
