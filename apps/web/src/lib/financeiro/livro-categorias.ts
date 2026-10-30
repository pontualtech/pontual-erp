// Categorias e regras iniciais de classificação do Livro-razão (cada linha de banco = 1 Transaction categorizada).

export type ModuloCategoria = 'financeiro_despesa' | 'financeiro_receita'

// Categoria de receita já existente em produção; usada ao categorizar baixas de OS.
export const CATEGORIA_RECEITA_SERVICOS = 'Venda de Servicos'

export const CATEGORIAS_LIVRO: { nome: string; modulo: ModuloCategoria }[] = [
  { nome: 'Ajuste de caixa', modulo: 'financeiro_despesa' },
  { nome: 'A classificar', modulo: 'financeiro_despesa' },
  { nome: 'Transferência entre contas', modulo: 'financeiro_despesa' },
  { nome: 'Transferência entre empresas', modulo: 'financeiro_despesa' },
  { nome: 'Receita a identificar', modulo: 'financeiro_receita' },
  { nome: 'Rendimentos', modulo: 'financeiro_receita' },
  { nome: 'Venda de Servicos', modulo: 'financeiro_receita' },
  { nome: 'Anúncios', modulo: 'financeiro_despesa' },
  { nome: 'Sistemas e Assinaturas', modulo: 'financeiro_despesa' },
  { nome: 'Telefone e Internet', modulo: 'financeiro_despesa' },
  { nome: 'Energia', modulo: 'financeiro_despesa' },
  { nome: 'Despesas Bancárias', modulo: 'financeiro_despesa' },
  { nome: 'Peças e Fornecedores', modulo: 'financeiro_despesa' },
]

// Categorias que já existem em produção (as regras podem apontar para elas; não são recriadas aqui).
const CATEGORIAS_EXISTENTES: { nome: string; modulo: ModuloCategoria }[] = [
  { nome: 'Impostos', modulo: 'financeiro_despesa' },
  { nome: 'Retirada Socios', modulo: 'financeiro_despesa' },
]

export const REGRAS_INICIAIS: { pattern: string; direction: 'IN' | 'OUT'; categoria: string }[] = [
  { pattern: 'GOOGLE ADS', direction: 'OUT', categoria: 'Anúncios' },
  { pattern: 'MICROSOFT*ADS', direction: 'OUT', categoria: 'Anúncios' },
  { pattern: 'FACEBK', direction: 'OUT', categoria: 'Anúncios' },
  { pattern: 'MINISTERIO DA FAZENDA', direction: 'OUT', categoria: 'Impostos' },
  { pattern: 'AQUALIFE', direction: 'OUT', categoria: 'Retirada Socios' },
  { pattern: 'CLARO', direction: 'OUT', categoria: 'Telefone e Internet' },
  { pattern: 'ELETROPAULO', direction: 'OUT', categoria: 'Energia' },
  { pattern: 'IOF', direction: 'OUT', categoria: 'Despesas Bancárias' },
  { pattern: 'REND PAGO APLIC', direction: 'IN', categoria: 'Rendimentos' },
  { pattern: 'YOUTUBE', direction: 'OUT', categoria: 'Sistemas e Assinaturas' },
  { pattern: 'GOOGLE ONE', direction: 'OUT', categoria: 'Sistemas e Assinaturas' },
  { pattern: 'GOOGLE CLOUD', direction: 'OUT', categoria: 'Sistemas e Assinaturas' },
  { pattern: 'TINY ERP', direction: 'OUT', categoria: 'Sistemas e Assinaturas' },
  { pattern: 'RESEND', direction: 'OUT', categoria: 'Sistemas e Assinaturas' },
  // Pagamento da fatura do cartão Inter, até existir a conta-cartão (Plano 2).
  { pattern: 'BANCO INTER S A', direction: 'OUT', categoria: 'Transferência entre contas' },
]

/**
 * Garante (idempotente) as categorias do livro e as regras iniciais para a empresa.
 * Categoria: busca por (company_id, module, name), cria se faltar. Regra: cria só se não
 * houver outra com o mesmo pattern + direction. Retorna nome → id.
 */
export async function garantirCategoriasERegras(tx: any, companyId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const cat of [...CATEGORIAS_LIVRO, ...CATEGORIAS_EXISTENTES]) {
    const where = { company_id: companyId, module: cat.modulo, name: cat.nome }
    const existente = await tx.category.findFirst({ where })
    const row = existente ?? (await tx.category.create({ data: where }))
    ids.set(cat.nome, row.id)
  }

  for (const regra of REGRAS_INICIAIS) {
    const categoryId = ids.get(regra.categoria)
    if (!categoryId) continue
    const where = { company_id: companyId, pattern: regra.pattern, direction: regra.direction }
    const existente = await tx.classificationRule.findFirst({ where })
    if (!existente) await tx.classificationRule.create({ data: { ...where, category_id: categoryId } })
  }
  return ids
}
