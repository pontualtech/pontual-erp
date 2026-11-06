import { describe, it, expect } from 'vitest'
import { idsJaNoBanco, itemDeTransacao } from './extrato-itens'

const base = {
  id: 't1',
  amount: 12345,
  transaction_type: 'CREDIT',
  description: 'PIX RECEBIDO ACME',
  bank_ref: 'ref1',
  reconciled: false,
  transaction_date: new Date('2026-10-05T00:00:00.000Z'),
  category_id: 'c1',
  origin: 'BANCO',
  source_text: 'PIX RECEBIDO ACME LTDA',
  created_at: new Date('2026-10-06T12:00:00.000Z'),
  categories: { name: 'Receita a identificar' },
  linked_ref: null,
}

describe('itemDeTransacao', () => {
  it('mapeia categoria, livro e texto do banco', () => {
    const i = itemDeTransacao(base, 'Itaú')
    expect(i.categoria).toBe('Receita a identificar')
    expect(i.category_id).toBe('c1')
    expect(i.livro).toBe(true)
    expect(i.texto_banco).toBe('PIX RECEBIDO ACME LTDA')
    expect(i.criado_em).toBe('2026-10-06T12:00:00.000Z')
    expect(i.origem).toBe('transacao')
    expect(i.tipo).toBe('ENTRADA')
    expect(i.conta_bancaria).toBe('Itaú')
    expect(i.data).toBe('2026-10-05T00:00:00.000Z')
  })

  it('F12: ligada = linked_ref != null', () => {
    expect(itemDeTransacao(base, 'x').ligada).toBe(false)
    expect(itemDeTransacao({ ...base, linked_ref: 'AR:a1' }, 'x').ligada).toBe(true)
    expect(itemDeTransacao({ ...base, linked_ref: 'AP:p1' }, 'x').ligada).toBe(true)
  })

  it('livro só é true com origin BANCO', () => {
    expect(itemDeTransacao({ ...base, origin: null }, 'x').livro).toBe(false)
    expect(itemDeTransacao({ ...base, origin: 'OFX' }, 'x').livro).toBe(false)
  })

  it('sem categoria mostra —', () => {
    const i = itemDeTransacao({ ...base, category_id: null, categories: null }, 'x')
    expect(i.categoria).toBe('—')
    expect(i.category_id).toBeNull()
  })

  it('DEBIT é SAIDA e sem source_text/created_at', () => {
    const i = itemDeTransacao({ ...base, transaction_type: 'DEBIT', source_text: null, created_at: null }, 'x')
    expect(i.tipo).toBe('SAIDA')
    expect(i.texto_banco).toBeNull()
    expect(i.criado_em).toBeNull()
  })
})

// 06/11 (folha): com a conta filtrada o salário aparecia 2x, como conta paga e como saída do banco
describe('idsJaNoBanco', () => {
  it('pega a conta ligada à linha do banco e a do lançamento da baixa', () => {
    const ids = idsJaNoBanco([{ bank_ref: 'ASAAS:x', linked_ref: 'AP:ap1' }, { bank_ref: 'AR:ar1', linked_ref: null }])
    expect([...ids].sort()).toEqual(['ap1', 'ar1'])
  })
  it('ignora estorno, antecipação e referência de outra origem', () => {
    const ids = idsJaNoBanco([
      { bank_ref: 'AR:ar2:estorno', linked_ref: null },
      { bank_ref: 'AR:ar3:anticipation', linked_ref: null },
      { bank_ref: 'ITAU:2026-11-05|X|100|1', linked_ref: 'acquirer:abc' },
      { bank_ref: null, linked_ref: null },
    ])
    expect(ids.size).toBe(0)
  })
})
