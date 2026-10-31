import { describe, it, expect, vi } from 'vitest'
import { categoriaReceitaPadraoId } from './categoria-receita-padrao'

// O mock devolve as categorias na ordem em que o banco devolveria (name asc, id asc).
function dbMock(lista: { id: string; name: string }[]) {
  const findMany = vi.fn().mockResolvedValue(lista)
  return { category: { findMany } } as any
}

describe('categoriaReceitaPadraoId', () => {
  it('usa "Venda de Servicos" quando a empresa tem', async () => {
    const db = dbMock([{ id: 'a', name: 'Receita a identificar' }, { id: 'cat-serv', name: 'Venda de Servicos' }, { id: 'p', name: 'Venda de Pecas' }])
    expect(await categoriaReceitaPadraoId(db, 'emp1')).toBe('cat-serv')
    expect(db.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { company_id: 'emp1', module: 'financeiro_receita' },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    )
  })

  it('tolera acento: "Venda de Serviços"', async () => {
    const db = dbMock([{ id: 'a', name: 'Receita a identificar' }, { id: 'acentuada', name: 'Venda de Serviços' }])
    expect(await categoriaReceitaPadraoId(db, 'emp1')).toBe('acentuada')
  })

  it('tolera caixa: "VENDA DE SERVICOS"', async () => {
    const db = dbMock([{ id: 'a', name: 'Receita a identificar' }, { id: 'caixa', name: 'VENDA DE SERVICOS' }])
    expect(await categoriaReceitaPadraoId(db, 'emp1')).toBe('caixa')
  })

  it('casa por prefixo: "Venda de Serviços - Garantia"', async () => {
    const db = dbMock([{ id: 'a', name: 'Receita a identificar' }, { id: 'gar', name: 'Venda de Serviços - Garantia' }])
    expect(await categoriaReceitaPadraoId(db, 'emp1')).toBe('gar')
  })

  it('duplicadas por acento: fica a 1ª na ordem name asc, id asc', async () => {
    const db = dbMock([{ id: 'a1', name: 'Venda de Servicos' }, { id: 'b1', name: 'Venda de Serviços' }])
    expect(await categoriaReceitaPadraoId(db, 'emp1')).toBe('a1')
  })

  it('só técnicas/outras (sem Venda de Servicos): null, sem chute', async () => {
    const db = dbMock([{ id: 'c', name: 'Outras receitas' }, { id: 'a', name: 'Receita a identificar' }, { id: 'b', name: 'Rendimentos' }])
    expect(await categoriaReceitaPadraoId(db, 'emp1')).toBeNull()
  })

  it('sem nenhuma categoria: null', async () => {
    expect(await categoriaReceitaPadraoId(dbMock([]), 'emp1')).toBeNull()
  })
})
