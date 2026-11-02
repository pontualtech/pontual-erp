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
  it('onda 4 (fix 1.3): linha BANCO convertida sem categoria usa a ref antiga (linked_ref) — AR:/acquirer:/pay_/cnab: → receita de serviços', () => {
    for (const ref of ['AR:x', 'acquirer:rede:1', 'pay_z', 'cnab:123']) {
      expect(categoriaEfetiva({ transaction_type: 'CREDIT', bank_ref: 'ITAU:k', linked_ref: ref, categoria: null })).toBe(CATEGORIA_RECEITA_SERVICOS)
    }
    expect(categoriaEfetiva({ transaction_type: 'DEBIT', bank_ref: 'ITAU:k', linked_ref: 'AP:1', categoria: null })).toBe('A classificar')
    expect(categoriaEfetiva({ transaction_type: 'CREDIT', bank_ref: 'ITAU:k', linked_ref: null, categoria: null })).toBe('Receita a identificar')
    // ref antiga de transferência/estorno continua fora do total
    expect(categoriaEfetiva({ transaction_type: 'DEBIT', bank_ref: 'ITAU:k', linked_ref: 'TRANSFER:t1', categoria: null })).toBe('Transferência entre contas')
    expect(categoriaEfetiva({ transaction_type: 'CREDIT', bank_ref: 'ITAU:k', linked_ref: 'AP:1:estorno', categoria: null })).toBe('Estornos')
    // categoria definida continua mandando
    expect(categoriaEfetiva({ transaction_type: 'CREDIT', bank_ref: 'ITAU:k', linked_ref: 'AR:x', categoria: 'Rendimentos' })).toBe('Rendimentos')
  })
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
  it('F8 / F4-G: transferências ficam fora do total; estornos deduzem do lado oposto (não vão para fora_do_total)', () => {
    const r = resumoRealizado([
      t('CREDIT', 15000, null, 'AR:a1'),
      t('DEBIT', 15000, null, 'AR:a1:estorno'),
      t('DEBIT', 4000, null, 'AP:p1'),
      t('CREDIT', 4000, null, 'AP:p1:estorno'),
      t('DEBIT', 7000, null, 'TRANSFER:c1'),
      t('CREDIT', 7000, null, 'TRANSFER:d1'),
    ])
    expect(r.total_entradas).toBe(0)
    expect(r.total_saidas).toBe(0)
    expect(r.fora_do_total).toEqual([{ categoria: 'Transferência entre contas', total: 14000 }])
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

describe('F4-G (m2, m5, m19): estorno/reembolso deduz, não some', () => {
  it('AR 500 + estorno 500 → total_entradas 0; o detalhamento de entradas mostra Estornos negativo', () => {
    const r = resumoRealizado([t('CREDIT', 50000, null, 'AR:a1'), t('DEBIT', 50000, null, 'AR:a1:estorno')])
    expect(r.total_entradas).toBe(0)
    expect(r.entradas).toEqual([{ categoria: CATEGORIA_RECEITA_SERVICOS, total: 50000 }, { categoria: 'Estornos', total: -50000 }])
    expect(r.total_saidas).toBe(0)
    expect(r.fora_do_total).toEqual([])
  })

  it('pay_x 485 + reembolso 500 (nocional sem categoria, m19) → entradas −15', () => {
    const r = resumoRealizado([t('CREDIT', 48500, null, 'pay_x'), t('DEBIT', 50000, null, 'pay_x-refund')])
    expect(r.total_entradas).toBe(-1500)
    expect(r.total_saidas).toBe(0)
  })

  it('o mesmo reembolso já convertido (categoria Estornos ou linked_ref pay_x-chargeback) dá o mesmo total (m5)', () => {
    const conv = resumoRealizado([t('CREDIT', 48500, CATEGORIA_RECEITA_SERVICOS, 'ITAU:k'), t('DEBIT', 50000, 'Estornos', 'ITAU:k2')])
    expect(conv.total_entradas).toBe(-1500)
    const cb = resumoRealizado([
      t('CREDIT', 48500, null, 'pay_x'),
      { transaction_type: 'DEBIT', amount: 50000, bank_ref: 'ITAU:k3', linked_ref: 'pay_x-chargeback', categoria: null },
    ])
    expect(cb.total_entradas).toBe(-1500)
  })

  it('AP 100 + CREDIT AP:p:estorno 100 → total_saidas 0 (Estornos negativo nas saídas)', () => {
    const r = resumoRealizado([t('DEBIT', 10000, 'Energia', 'AP:p'), t('CREDIT', 10000, null, 'AP:p:estorno')])
    expect(r.total_saidas).toBe(0)
    expect(r.saidas).toEqual([{ categoria: 'Energia', total: 10000 }, { categoria: 'Estornos', total: -10000 }])
    expect(r.total_entradas).toBe(0)
  })

  it('categoriaEfetiva: DEBIT sem categoria com ref -refund/-chargeback (bank_ref ou linked_ref) → Estornos; CREDIT continua receita', () => {
    expect(categoriaEfetiva({ transaction_type: 'DEBIT', bank_ref: 'pay_x-refund', categoria: null })).toBe('Estornos')
    expect(categoriaEfetiva({ transaction_type: 'DEBIT', bank_ref: 'pay_x-chargeback', categoria: null })).toBe('Estornos')
    expect(categoriaEfetiva({ transaction_type: 'DEBIT', bank_ref: 'ASAAS:k', linked_ref: 'pay_x-refund', categoria: null })).toBe('Estornos')
    expect(categoriaEfetiva({ transaction_type: 'CREDIT', bank_ref: 'pay_x', categoria: null })).toBe(CATEGORIA_RECEITA_SERVICOS)
  })
})
