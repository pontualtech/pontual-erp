import type { prisma } from '@pontual/db'
import { CATEGORIA_RECEITA_SERVICOS } from './livro-categorias'

// Sem acento, minúscula e aparada: tolera "Venda de Serviços" / "VENDA DE SERVICOS".
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Categoria de receita padrão de uma conta a receber: "Venda de Servicos" (sem distinguir acento/caixa); senão a 1ª que comece com "Venda de Servi"; senão null (sem chute). */
export async function categoriaReceitaPadraoId(
  db: Pick<typeof prisma, 'category'>, // prisma ou tx
  companyId: string,
): Promise<string | null> {
  const categorias = await db.category.findMany({
    where: { company_id: companyId, module: 'financeiro_receita' },
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
  const lista = categorias.map((c) => ({ id: c.id, nome: normalizar(c.name) }))
  const alvo = normalizar(CATEGORIA_RECEITA_SERVICOS)
  return (lista.find((c) => c.nome === alvo) ?? lista.find((c) => c.nome.startsWith('venda de servi')))?.id ?? null
}
