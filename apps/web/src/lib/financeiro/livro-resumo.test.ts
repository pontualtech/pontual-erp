import { describe, it, expect } from 'vitest'
import { categoriaEfetiva, CATEGORIAS_FORA_DO_TOTAL, resumoRealizado } from './livro-resumo'
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
  it('F8: estorno sem categoria (AP:x:estorno CREDIT, AR:x:estorno DEBIT) vira Estornos, não receita/despesa', () => {
    expect(categoriaEfetiva({ transaction_type: 'CREDIT', bank_ref: 'AP:1:estorno', categoria: null })).toBe('Estornos')
    expect(categoriaEfetiva({ transaction_type: 'DEBIT', bank_ref: 'AR:1:estorno', categoria: null })).toBe('Estornos')
  })
  it('F8: TRANSFER: sem categoria vira Transferência entre contas (nos dois sentidos)', () => {
    expect(categoriaEfetiva({ transaction_type: 'CREDIT', bank_ref: 'TRANSFER:abc', categoria: null })).toBe('Transferência entre contas')
    expect(categoriaEfetiva({ transaction_type: 'DEBIT', bank_ref: 'TRANSFER:abc', categoria: null })).toBe('Transferência entre contas')
  })
  it('F8: categoria explícita ainda vence o bank_ref', () => {
    expect(categoriaEfetiva({ transaction_type: 'DEBIT', bank_ref: 'AR:1:estorno', categoria: 'Venda de Servicos' })).toBe('Venda de Servicos')
  })
})

describe('resumoRealizado', () => {
  it('ajuste de caixa vai para fora_do_total e não entra nos totais', () => {
    const r = resumoRealizado([t('DEBIT', 55104255, 'Ajuste de caixa'), t('DEBIT', 1000, 'Energia')])
    expect(r.fora_do_total).toEqual([{ categoria: 'Ajuste de caixa', total: 55104255 }])
    expect(r.total_saidas).toBe(1000)
    expect(r.saidas).toEqual([{ categoria: 'Energia', total: 1000 }])
  })
  it('F8: Estornos está em CATEGORIAS_FORA_DO_TOTAL', () => {
    expect(CATEGORIAS_FORA_DO_TOTAL).toContain('Estornos')
  })
  it('F8: estornos e transferências sem categoria ficam fora do total', () => {
    const r = resumoRealizado([
      t('CREDIT', 15000, null, 'AR:a1'),
      t('DEBIT', 15000, null, 'AR:a1:estorno'),
      t('CREDIT', 4000, null, 'AP:p1:estorno'),
      t('DEBIT', 7000, null, 'TRANSFER:c1'),
      t('CREDIT', 7000, null, 'TRANSFER:d1'),
    ])
    expect(r.total_entradas).toBe(15000)
    expect(r.total_saidas).toBe(0)
    expect(r.fora_do_total).toEqual([
      { categoria: 'Estornos', total: 19000 },
      { categoria: 'Transferência entre contas', total: 14000 },
    ])
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
