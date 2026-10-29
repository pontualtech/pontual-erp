import { describe, it, expect } from 'vitest'
import { CATEGORIAS_LIVRO, REGRAS_INICIAIS, garantirCategoriasERegras } from './livro-categorias'

const EXISTENTES = ['Impostos', 'Salarios', 'Retirada Socios', 'Combustiveis', 'Taxas de Cartao (Operadora)']

describe('CATEGORIAS_LIVRO e REGRAS_INICIAIS são coerentes', () => {
  const nomes = CATEGORIAS_LIVRO.map((c) => c.nome)

  it('toda regra aponta para categoria conhecida', () => {
    for (const r of REGRAS_INICIAIS) {
      expect([...nomes, ...EXISTENTES], r.pattern).toContain(r.categoria)
    }
  })

  it('contém as categorias novas', () => {
    for (const n of ['Ajuste de caixa', 'A classificar', 'Transferência entre contas', 'Transferência entre empresas',
      'Receita a identificar', 'Rendimentos', 'Anúncios', 'Sistemas e Assinaturas', 'Telefone e Internet', 'Energia',
      'Despesas Bancárias', 'Peças e Fornecedores']) {
      expect(nomes).toContain(n)
    }
    const modulo = (n: string) => CATEGORIAS_LIVRO.find((c) => c.nome === n)?.modulo
    expect(modulo('Receita a identificar')).toBe('financeiro_receita')
    expect(modulo('Rendimentos')).toBe('financeiro_receita')
  })

  it('contém as regras iniciais', () => {
    const esperado: [string, 'IN' | 'OUT', string][] = [
      ['GOOGLE ADS', 'OUT', 'Anúncios'], ['MICROSOFT*ADS', 'OUT', 'Anúncios'], ['FACEBK', 'OUT', 'Anúncios'],
      ['MINISTERIO DA FAZENDA', 'OUT', 'Impostos'], ['AQUALIFE', 'OUT', 'Retirada Socios'],
      ['CLARO', 'OUT', 'Telefone e Internet'], ['ELETROPAULO', 'OUT', 'Energia'], ['IOF', 'OUT', 'Despesas Bancárias'],
      ['REND PAGO APLIC', 'IN', 'Rendimentos'], ['YOUTUBE', 'OUT', 'Sistemas e Assinaturas'],
      ['GOOGLE ONE', 'OUT', 'Sistemas e Assinaturas'], ['GOOGLE CLOUD', 'OUT', 'Sistemas e Assinaturas'],
      ['TINY ERP', 'OUT', 'Sistemas e Assinaturas'], ['RESEND', 'OUT', 'Sistemas e Assinaturas'],
      ['BANCO INTER S A', 'OUT', 'Transferência entre contas'],
    ]
    for (const [pattern, direction, categoria] of esperado) {
      expect(REGRAS_INICIAIS).toContainEqual({ pattern, direction, categoria })
    }
  })
})

function fakeTx() {
  const categories: any[] = []
  const rules: any[] = []
  let n = 0
  return {
    categories, rules,
    category: {
      findFirst: async ({ where }: any) =>
        categories.find((c) => c.company_id === where.company_id && c.module === where.module && c.name === where.name) ?? null,
      create: async ({ data }: any) => { const c = { id: `c${++n}`, ...data }; categories.push(c); return c },
    },
    classificationRule: {
      findFirst: async ({ where }: any) =>
        rules.find((r) => r.company_id === where.company_id && r.pattern === where.pattern && r.direction === where.direction) ?? null,
      create: async ({ data }: any) => { const r = { id: `r${++n}`, ...data }; rules.push(r); return r },
    },
  }
}

describe('garantirCategoriasERegras', () => {
  it('é idempotente e devolve nome → id', async () => {
    const tx = fakeTx()
    const mapa = await garantirCategoriasERegras(tx as any, 'co1')
    const cats = tx.categories.length
    const regras = tx.rules.length
    expect(cats).toBeGreaterThan(0)
    expect(regras).toBe(REGRAS_INICIAIS.length)
    expect(mapa.get('Anúncios')).toBeTruthy()
    expect(mapa.get('Impostos')).toBeTruthy()

    const mapa2 = await garantirCategoriasERegras(tx as any, 'co1')
    expect(tx.categories.length).toBe(cats)
    expect(tx.rules.length).toBe(regras)
    expect(mapa2.get('Anúncios')).toBe(mapa.get('Anúncios'))
  })

  it('reaproveita categoria já existente', async () => {
    const tx = fakeTx()
    tx.categories.push({ id: 'old', company_id: 'co1', module: 'financeiro_despesa', name: 'Impostos' })
    const mapa = await garantirCategoriasERegras(tx as any, 'co1')
    expect(mapa.get('Impostos')).toBe('old')
    expect(tx.categories.filter((c) => c.name === 'Impostos')).toHaveLength(1)
  })
})
