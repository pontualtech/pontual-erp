// Decisão pura da baixa (AR/AP) sobre o Livro-razão: ligar ao lançamento do banco já existente
// em vez de criar um segundo (que contaria o dinheiro duas vezes). Sem banco de dados, sem I/O.

export const CATEGORIAS_FALLBACK = ['A classificar', 'Receita a identificar'] as const

// Janela (dias) em torno da data da baixa para achar o lançamento do livro.
export const JANELA_BAIXA = { antes: 10, depois: 1 }

// Diferença máxima (centavos) aceita quando o usuário escolhe o lançamento explicitamente.
const TOLERANCIA_EXPLICITO = 100

export interface CandidatoLivro {
  id: string
  amount: number
  transaction_type: 'CREDIT' | 'DEBIT'
  transaction_date: string // AAAA-MM-DD
  categoria: string | null
  linked_ref: string | null
  origin: string | null
}

export type DecisaoBaixa = { usar: string } | { criar: true } | { erro: string }

const DIA_MS = 86_400_000

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA_MS)
}

function emFallback(categoria: string | null): boolean {
  return categoria !== null && (CATEGORIAS_FALLBACK as readonly string[]).includes(categoria)
}

export function decidirBaixa(
  alvo: { tipo: 'CREDIT' | 'DEBIT'; amount: number; data: string },
  explicito: string | null,
  candidatos: CandidatoLivro[],
): DecisaoBaixa {
  if (explicito) {
    const c = candidatos.find((x) => x.id === explicito)
    if (!c) return { erro: 'Lançamento do livro não encontrado' }
    if (c.origin !== 'BANCO') return { erro: 'Lançamento não é do livro (banco)' }
    if (c.transaction_type !== alvo.tipo) return { erro: 'Lançamento do livro é de outro tipo' }
    if (c.linked_ref) return { erro: 'Lançamento do livro já está ligado a outra baixa' }
    if (!emFallback(c.categoria)) return { erro: 'Lançamento do livro já está categorizado' }
    if (Math.abs(c.amount - alvo.amount) > TOLERANCIA_EXPLICITO) return { erro: 'Valor do lançamento difere mais de R$ 1,00 da baixa' }
    return { usar: c.id }
  }

  let melhor: { id: string; dist: number } | null = null
  for (const c of candidatos) {
    if (c.origin !== 'BANCO' || c.transaction_type !== alvo.tipo || c.amount !== alvo.amount) continue
    if (c.linked_ref || !emFallback(c.categoria)) continue
    const delta = diasEntre(c.transaction_date, alvo.data) // negativo = antes da baixa
    if (delta < -JANELA_BAIXA.antes || delta > JANELA_BAIXA.depois) continue
    const dist = Math.abs(delta)
    if (!melhor || dist < melhor.dist) melhor = { id: c.id, dist }
  }
  return melhor ? { usar: melhor.id } : { criar: true }
}
