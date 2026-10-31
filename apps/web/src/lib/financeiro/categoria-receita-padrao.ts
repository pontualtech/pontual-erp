import { CATEGORIA_RECEITA_SERVICOS } from './livro-categorias'

// Categorias de receita técnicas do livro-razão: nunca são o padrão de uma conta a receber.
export const CATEGORIAS_RECEITA_TECNICAS = ['Receita a identificar', 'Rendimentos'] as const

/** Categoria de receita padrão de uma conta a receber: "Venda de Servicos"; se a empresa não tiver, a 1ª de receita por nome que não seja técnica do livro; senão null. */
export async function categoriaReceitaPadraoId(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  db: { category: { findFirst: Function; findMany: Function } }, // Prisma client ou tx
  companyId: string,
): Promise<string | null> {
  const servicos = await db.category.findFirst({
    where: { company_id: companyId, module: 'financeiro_receita', name: CATEGORIA_RECEITA_SERVICOS },
    select: { id: true },
  })
  if (servicos?.id) return servicos.id

  const outras = await db.category.findMany({
    where: { company_id: companyId, module: 'financeiro_receita', name: { notIn: [...CATEGORIAS_RECEITA_TECNICAS] } },
    orderBy: { name: 'asc' },
    take: 1,
    select: { id: true },
  })
  return outras[0]?.id ?? null
}
