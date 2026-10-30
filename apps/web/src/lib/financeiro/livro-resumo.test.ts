import { describe, it, expect } from 'vitest'
import { categoriaEfetiva, resumoRealizado } from './livro-resumo'
import { CATEGORIA_RECEITA_SERVICOS } from './livro-categorias'

const t = (transaction_type: string, amount: number, categoria: string | null, bank_ref: string | null = null) => ({
  transaction_type,
  amount,
  bank_ref,
  categoria,
})

describe('categoriaEfetiva', () => {
  it('usa a categoria quando existe', () => {
    expect(categoriaEfetiva({ transaction_type: 'DEBIT', bank_ref: null, categoria: 'Energia' })).toBe('Energia')
  })
  it('CREDIT AR:/acquirer:/pay_ sem categoria vira receita de serviços', () => {
    for (const ref of ['AR:x', 'acquirer:y', 'pay_z']) {
      expect(categoriaEfetiva({ transaction_type: 'CREDIT', bank_ref: ref, categoria: null })).toBe(CATEGORIA_RECEITA_SERVICOS)
    }
  })
  it('DEBIT AP: e demais sem categoria viram A classificar; CREDIT demais, Receita a identificar', () => {
    expect(categoriaEfetiva({ transaction_type: 'DEBIT', bank_ref: 'AP:1', categoria: null })).toBe('A classificar')
    expect(categoriaEfetiva({ transaction_type: 'DEBIT', bank_ref: null, categoria: null })).toBe('A classificar')
    expect(categoriaEfetiva({ transaction_type: 'CREDIT', bank_ref: 'x', categoria: null })).toBe('Receita a identificar')
  })
})

describe('resumoRealizado', () => {
  it('ajuste de caixa vai para fora_do_total e não entra nos totais', () => {
    const r = resumoRealizado([t('DEBIT', 55104255, 'Ajuste de caixa'), t('DEBIT', 1000, 'Energia')])
    expect(r.fora_do_total).toEqual([{ categoria: 'Ajuste de caixa', total: 55104255 }])
    expect(r.total_saidas).toBe(1000)
    expect(r.saidas).toEqual([{ categoria: 'Energia', total: 1000 }])
  })
  it('CREDIT AR:x sem categoria soma em Venda de Servicos', () => {
    const r = resumoRealizado([t('CREDIT', 500, null, 'AR:x'), t('CREDIT', 300, CATEGORIA_RECEITA_SERVICOS)])
    expect(r.entradas).toEqual([{ categoria: CATEGORIA_RECEITA_SERVICOS, total: 800 }])
    expect(r.total_entradas).toBe(800)
  })
  it('duas saídas Energia somam em uma linha, ordenadas por total desc', () => {
    const r = resumoRealizado([t('DEBIT', 100, 'Energia'), t('DEBIT', 200, 'Energia'), t('DEBIT', 400, 'Impostos')])
    expect(r.saidas).toEqual([
      { categoria: 'Impostos', total: 400 },
      { categoria: 'Energia', total: 300 },
    ])
    expect(r.total_saidas).toBe(700)
  })
})
