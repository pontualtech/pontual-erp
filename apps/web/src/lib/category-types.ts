// Feature 31/05 (audit Karlão): tipos de categoria financeira encodados
// no field Category.module pra evitar migration de schema.
// RECEITA = vendas/serviços; CUSTO = CMV/CPV; DESPESA = operacional; INVESTIMENTO = capex.
//
// Antes: só RECEITA e DESPESA → DRE mostrava Margem Bruta sempre 100%.
// Agora: DRE separa Lucro Bruto (Receita - Custo) de Lucro Líquido (- Despesa).

export const CATEGORY_TYPES = ['RECEITA', 'CUSTO', 'DESPESA', 'INVESTIMENTO'] as const
export type CategoryType = (typeof CATEGORY_TYPES)[number]

export const TYPE_TO_MODULE: Record<CategoryType, string> = {
  RECEITA: 'financeiro_receita',
  CUSTO: 'financeiro_custo',
  DESPESA: 'financeiro_despesa',
  INVESTIMENTO: 'financeiro_investimento',
}

export const MODULE_TO_TYPE: Record<string, CategoryType> = {
  financeiro_receita: 'RECEITA',
  financeiro_custo: 'CUSTO',
  financeiro_despesa: 'DESPESA',
  financeiro_investimento: 'INVESTIMENTO',
}

export const ALL_MODULES = Object.values(TYPE_TO_MODULE)

export const TYPE_LABELS: Record<CategoryType, string> = {
  RECEITA: 'Receitas',
  CUSTO: 'Custos (CMV/CPV)',
  DESPESA: 'Despesas',
  INVESTIMENTO: 'Investimentos',
}
