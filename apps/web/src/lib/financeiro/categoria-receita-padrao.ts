import type { prisma } from '@pontual/db'
import { CATEGORIAS_LIVRO, CATEGORIA_RECEITA_SERVICOS } from './livro-categorias'

// Categorias de receita técnicas do livro-razão: nunca são o padrão de uma conta a receber.
export const CATEGORIAS_RECEITA_TECNICAS: string[] = CATEGORIAS_LIVRO
  .filter((c) => c.modulo === 'financeiro_receita' && c.nome !== CATEGORIA_RECEITA_SERVICOS)
  .map((c) => c.nome)

// Sem acento, minúscula e aparada: tolera "Venda de Serviços" / "VENDA DE SERVICOS".
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Categoria de receita padrão de uma conta a receber: "Venda de Servicos" (sem distinguir acento/caixa); se a empresa não tiver, a 1ª de receita por nome que não seja técnica do livro; senão null. */
export async function categoriaReceitaPadraoId(
  db: Pick<typeof prisma, 'category'>, // prisma ou tx
  companyId: string,
): Promise<string | null> {
  const categorias = await db.category.findMany({
    where: { company_id: companyId, module: 'financeiro_receita' },
    select: { id: true, name: true },
  })
  const lista = categorias
    .map((c) => ({ id: c.id, nome: normalizar(c.name) }))
    .sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0))
  const alvo = normalizar(CATEGORIA_RECEITA_SERVICOS)
  const tecnicas = CATEGORIAS_RECEITA_TECNICAS.map(normalizar)
  return (
    lista.find((c) => c.nome === alvo) ??
    lista.find((c) => c.nome.startsWith('venda de servi')) ??
    lista.find((c) => !tecnicas.includes(c.nome))
  )?.id ?? null
}
