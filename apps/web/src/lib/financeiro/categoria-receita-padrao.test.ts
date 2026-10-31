import { describe, it, expect, vi } from 'vitest'
import { categoriaReceitaPadraoId } from './categoria-receita-padrao'

function dbMock(opts: { servicos?: { id: string } | null; lista?: { id: string; name: string }[] }) {
  const findFirst = vi.fn().mockResolvedValue(opts.servicos ?? null)
  const findMany = vi.fn().mockImplementation(async (args: any) => {
    const excluir: string[] = args?.where?.name?.notIn ?? []
    return (opts.lista ?? []).filter((c) => !excluir.includes(c.name)).sort((a, b) => a.name.localeCompare(b.name))
  })
  return { category: { findFirst, findMany } }
}

describe('categoriaReceitaPadraoId', () => {
  it('usa "Venda de Servicos" quando a empresa tem', async () => {
    const db = dbMock({ servicos: { id: 'cat-serv' } })
    expect(await categoriaReceitaPadraoId(db, 'emp1')).toBe('cat-serv')
    expect(db.category.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { company_id: 'emp1', module: 'financeiro_receita', name: 'Venda de Servicos' } }),
    )
  })

  it('sem "Venda de Servicos": 1ª por nome que não seja técnica', async () => {
    const db = dbMock({
      lista: [
        { id: 'a', name: 'Receita a identificar' },
        { id: 'b', name: 'Rendimentos' },
        { id: 'c', name: 'Outras receitas' },
      ],
    })
    expect(await categoriaReceitaPadraoId(db, 'emp1')).toBe('c')
    expect(db.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: 'asc' } }),
    )
  })

  it('sem nenhuma categoria utilizável: null', async () => {
    const db = dbMock({ lista: [{ id: 'a', name: 'Rendimentos' }] })
    expect(await categoriaReceitaPadraoId(db, 'emp1')).toBeNull()
  })
})
