// Núcleo puro do Livro-razão: classifica linhas de banco e planeja o lançamento (sem banco de dados, sem I/O).

export interface LinhaBanco {
  chave: string
  data: string // AAAA-MM-DD
  descricao: string
  valor_centavos: number // + entra, − sai
  contraparte?: string
  links?: string[] // bank_ref de créditos já existentes no ERP
}

export interface RegraClassificacao {
  id: string
  pattern: string
  direction: string | null
  account_id: string | null
  category_id: string
  priority: number
}

export type Plano =
  | { acao: 'IGNORAR'; motivo: string }
  | { acao: 'LIGAR'; refs: string[] }
  | { acao: 'CRIAR'; valor_centavos: number; refs_ligadas: string[]; identificar: boolean }

// Escolhe a categoria pela regra de menor priority (empate: a primeira do array).
// Pattern = substring sem diferenciar maiúsculas (sem regex) em descrição + contraparte.
export function classificar(
  linha: LinhaBanco,
  regras: RegraClassificacao[],
  accountId: string,
): { category_id: string | null; regra_id: string | null } {
  const texto = `${linha.descricao} ${linha.contraparte ?? ''}`.toLowerCase()
  let melhor: RegraClassificacao | null = null
  for (const r of regras) {
    if (r.account_id !== null && r.account_id !== accountId) continue
    if (r.direction === 'IN' && !(linha.valor_centavos > 0)) continue
    if (r.direction === 'OUT' && !(linha.valor_centavos < 0)) continue
    if (!texto.includes(r.pattern.toLowerCase())) continue
    if (melhor === null || r.priority < melhor.priority) melhor = r
  }
  return melhor
    ? { category_id: melhor.category_id, regra_id: melhor.id }
    : { category_id: null, regra_id: null }
}

// Decide o que fazer com a linha: ignorar (antes do corte / já lançada), ligar a créditos que o ERP já tem
// (para não contar o dinheiro duas vezes) ou criar a diferença.
export function planejarLinha(
  linha: LinhaBanco,
  corte: string,
  jaLancada: boolean,
  creditosExistentes: { bank_ref: string; amount: number }[],
): Plano {
  if (linha.data <= corte) return { acao: 'IGNORAR', motivo: 'antes do corte' }
  if (jaLancada) return { acao: 'IGNORAR', motivo: 'já lançada' }

  const links = new Set(linha.links ?? [])
  const existentes = creditosExistentes.filter((c) => links.has(c.bank_ref))
  const refs = existentes.map((c) => c.bank_ref)
  if (existentes.length === 0) {
    return { acao: 'CRIAR', valor_centavos: linha.valor_centavos, refs_ligadas: [], identificar: false }
  }

  const soma = existentes.reduce((s, c) => s + c.amount, 0)
  if (soma === linha.valor_centavos) return { acao: 'LIGAR', refs }
  return {
    acao: 'CRIAR',
    valor_centavos: linha.valor_centavos - soma,
    refs_ligadas: refs,
    identificar: soma < linha.valor_centavos,
  }
}

export interface CandidatoOrfao {
  id: string
  amount: number
  transaction_type: 'CREDIT' | 'DEBIT'
  transaction_date: string // AAAA-MM-DD
}

const MS_DIA = 86_400_000
const diaUtc = (d: string) => Date.parse(d + 'T00:00:00.000Z')

/**
 * Escolhe, entre transações já existentes ("órfãs"), a que corresponde à linha do banco:
 * mesmo sinal, mesmo valor e data em [data − 3 dias, data + 1 dia]. Vence a data mais próxima;
 * empate → o primeiro do array. Nenhum → null.
 */
export function escolherOrfao(linha: LinhaBanco, candidatos: CandidatoOrfao[]): string | null {
  const tipo = linha.valor_centavos > 0 ? 'CREDIT' : 'DEBIT'
  const alvo = diaUtc(linha.data)
  let melhor: string | null = null
  let melhorDist = Infinity
  for (const c of candidatos) {
    if (c.transaction_type !== tipo || c.amount !== Math.abs(linha.valor_centavos)) continue
    const dif = Math.round((diaUtc(c.transaction_date) - alvo) / MS_DIA)
    if (dif < -3 || dif > 1) continue
    const dist = Math.abs(dif)
    if (dist < melhorDist) {
      melhor = c.id
      melhorDist = dist
    }
  }
  return melhor
}
