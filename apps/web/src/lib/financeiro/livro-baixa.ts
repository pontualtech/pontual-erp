// Decisão pura da baixa (AR/AP) sobre o Livro-razão: ligar ao lançamento do banco já existente
// em vez de criar um segundo (que contaria o dinheiro duas vezes). Sem banco de dados, sem I/O.
import { CATEGORIAS_FORA_DO_TOTAL } from './livro-resumo'

export const CATEGORIAS_FALLBACK = ['A classificar', 'Receita a identificar'] as const

// Janela (dias) em torno da data da baixa para achar o lançamento do livro.
export type JanelaBaixa = { antes: number; depois: number }
// Receber/Pagar, ancorados na data real da baixa: antes: 10 (linha mais antiga pode ser de outro cliente);
// depois: 3 → baixa com data retroativa.
export const JANELA_BAIXA: JanelaBaixa = { antes: 10, depois: 3 }
// Conferir sem vínculo explícito (bulk-reconcile, ancorado em hoje): semanas depois do crédito ainda liga.
export const JANELA_CONFERIR: JanelaBaixa = { antes: 30, depois: 3 }

// Diferença máxima (centavos) aceita quando o usuário escolhe o lançamento explicitamente.
export const TOLERANCIA_EXPLICITO = 100

export interface CandidatoLivro {
  id: string
  amount: number
  transaction_type: 'CREDIT' | 'DEBIT'
  transaction_date: string // AAAA-MM-DD
  categoria: string | null
  category_id: string | null
  linked_ref: string | null
  origin: string | null
  desligada_de?: string | null // Fix 7 (F7-C): a ref que a linha pagava quando foi desligada
}

export type DecisaoBaixa = { usar: string } | { criar: true } | { erro: string }

const DIA_MS = 86_400_000

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA_MS)
}

function emFallback(categoria: string | null): boolean {
  return categoria !== null && (CATEGORIAS_FALLBACK as readonly string[]).includes(categoria)
}

// Ao ligar: só a linha sem categoria ou em fallback recebe a categoria da baixa; as demais mantêm a sua.
export function recebeCategoria(categoria: string | null): boolean {
  return categoria === null || emFallback(categoria)
}

// Onda 4: crédito do retorno CNAB da AR (cnab:<nossoNumero>, gravado no pix_code em JSON pelo cnab/route); null se não houver.
export function refCnab(pixCode: string | null | undefined): string | null {
  if (!pixCode) return null
  try {
    const n = (JSON.parse(pixCode) as { nossoNumero?: unknown } | null)?.nossoNumero
    return (typeof n === 'string' && n !== '') || typeof n === 'number' ? `cnab:${n}` : null
  } catch {
    return null // pix_code com o copia-e-cola do PIX, não JSON
  }
}

// `alvo.categoria` = nome da categoria da conta a pagar/receber (desempate: mesma categoria antes das outras).
export function decidirBaixa(
  alvo: { tipo: 'CREDIT' | 'DEBIT'; amount: number; data: string; categoria?: string | null; dono?: string | null },
  explicito: string | null,
  candidatos: CandidatoLivro[],
  janela: JanelaBaixa = JANELA_BAIXA, // a mesma passada a candidatosLivro
): DecisaoBaixa {
  if (explicito) {
    const c = candidatos.find((x) => x.id === explicito)
    if (!c) return { erro: 'Lançamento do livro não encontrado' }
    if (c.origin !== 'BANCO') return { erro: 'Lançamento não é do livro (banco)' }
    if (c.transaction_type !== alvo.tipo) return { erro: 'Lançamento do livro é de outro tipo' }
    if (c.linked_ref) return { erro: 'Lançamento do livro já está ligado a outra baixa' }
    // Aceita linha em fallback ou já na MESMA categoria da conta (ex.: regra ELETROPAULO → Energia para AP Energia).
    // Onda 4 (§6): conta sem categoria aceita a categoria da linha (menos ajuste/transferência) — a conta a recebe.
    const mesmaCategoria = alvo.categoria
      ? c.categoria === alvo.categoria
      : c.categoria !== null && !CATEGORIAS_FORA_DO_TOTAL.includes(c.categoria)
    if (!emFallback(c.categoria) && !mesmaCategoria) return { erro: 'Lançamento do livro já está categorizado' }
    if (Math.abs(c.amount - alvo.amount) > TOLERANCIA_EXPLICITO) return { erro: 'Valor do lançamento difere mais de R$ 1,00 da baixa' }
    return { usar: c.id }
  }

  // Automático: linha do banco livre, de mesmo tipo e valor, na janela — exceto ajuste/transferências.
  // Só aceita fallback (ou sem categoria) > mesma categoria do alvo; categoria alheia NUNCA (seria o lançamento
  // de outro favorecido). Onda 4 (§6, #14): alvo SEM categoria aceita qualquer categoria como rank 1 (a conta recebe
  // a da linha — ex.: regra ELETROPAULO → Energia para AP sem categoria). Depois, a data mais próxima.
  // Fix 8 (F8-C, m3): linha desligada de OUTRA conta (suja = 1) só quando não há candidata limpa de mesmo valor.
  let melhor: { id: string; suja: number; rank: number; dist: number } | null = null
  const antes = (a: { suja: number; rank: number; dist: number }, b: typeof a) =>
    a.suja !== b.suja ? a.suja < b.suja : a.rank !== b.rank ? a.rank < b.rank : a.dist < b.dist
  for (const c of candidatos) {
    if (c.origin !== 'BANCO' || c.transaction_type !== alvo.tipo || c.amount !== alvo.amount) continue
    if (c.linked_ref) continue
    // Fix 8 (F8-C, m8): ajuste/transferência/estorno nunca, nem para religar.
    if (c.categoria !== null && CATEGORIAS_FORA_DO_TOTAL.includes(c.categoria)) continue
    // Fix 7 (F7-C, #6/#7): a linha que pagava ESTA conta e foi desligada (Desfazer) é religada — qualquer data,
    // qualquer categoria (a regra pode tê-la reclassificado), prioridade máxima.
    if (alvo.dono && c.desligada_de === alvo.dono) {
      const cand = { id: c.id, suja: -1, rank: -1, dist: Math.abs(diasEntre(c.transaction_date, alvo.data)) }
      if (!melhor || antes(cand, melhor)) melhor = cand
      continue
    }
    const delta = diasEntre(c.transaction_date, alvo.data) // negativo = antes da baixa
    if (delta < -janela.antes || delta > janela.depois) continue
    const rank = recebeCategoria(c.categoria) ? 0 : !alvo.categoria || c.categoria === alvo.categoria ? 1 : 2
    if (rank === 2) continue
    const cand = { id: c.id, suja: c.desligada_de ? 1 : 0, rank, dist: Math.abs(delta) }
    if (!melhor || antes(cand, melhor)) melhor = cand
  }
  return melhor ? { usar: melhor.id } : { criar: true }
}
