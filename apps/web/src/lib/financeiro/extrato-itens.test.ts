import { describe, it, expect } from 'vitest'
import { itemDeTransacao } from './extrato-itens'

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
