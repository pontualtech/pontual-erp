import { describe, it, expect, vi } from 'vitest'
import { categoriaReceitaPadraoId } from './categoria-receita-padrao'

function dbMock(lista: { id: string; name: string }[]) {
  const findMany = vi.fn().mockResolvedValue(lista)
  return { category: { findMany } } as any
}

describe('categoriaReceitaPadraoId', () => {
  it('usa "Venda de Servicos" quando a empresa tem', async () => {
    const db = dbMock([{ id: 'a', name: 'Receita a identificar' }, { id: 'cat-serv', name: 'Venda de Servicos' }, { id: 'p', name: 'Venda de Pecas' }])
    expect(await categoriaReceitaPadraoId(db, 'emp1')).toBe('cat-serv')
    expect(db.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { company_id: 'emp1', module: 'financeiro_receita' } }),
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

  it('sem "Venda de Servicos": 1ª por nome que não seja técnica', async () => {
    const db = dbMock([
      { id: 'a', name: 'Receita a identificar' },
      { id: 'b', name: 'Rendimentos' },
      { id: 'c', name: 'Outras receitas' },
    ])
    expect(await categoriaReceitaPadraoId(db, 'emp1')).toBe('c')
  })

  it('sem nenhuma categoria utilizável: null', async () => {
    expect(await categoriaReceitaPadraoId(dbMock([{ id: 'a', name: 'Rendimentos' }]), 'emp1')).toBeNull()
    expect(await categoriaReceitaPadraoId(dbMock([]), 'emp1')).toBeNull()
  })
})
