import { describe, it, expect } from 'vitest'
import { classificar, planejarLinha, escolherOrfao, limitesJanelaOrfao, creditoUsavelParaVinculo, type LinhaBanco } from './livro'

const CORTE = '2026-10-29'

function linha(p: Partial<LinhaBanco> = {}): LinhaBanco {
  return { chave: 'k1', data: '2026-10-30', descricao: 'PIX RECEBIDO', valor_centavos: 10000, ...p }
}

describe('planejarLinha', () => {
  it('data <= corte -> IGNORAR', () => {
    expect(planejarLinha(linha({ data: '2026-10-29' }), CORTE, false, []).acao).toBe('IGNORAR')
    expect(planejarLinha(linha({ data: '2026-10-01' }), CORTE, false, []).acao).toBe('IGNORAR')
  })

  it('jaLancada -> IGNORAR', () => {
    expect(planejarLinha(linha(), CORTE, true, []).acao).toBe('IGNORAR')
  })

  it('links somam exato o valor -> LIGAR com as refs', () => {
    const p = planejarLinha(linha({ links: ['a', 'b'] }), CORTE, false, [
      { bank_ref: 'a', amount: 6000 },
      { bank_ref: 'b', amount: 4000 },
    ])
    expect(p).toEqual({ acao: 'LIGAR', refs: ['a', 'b'] })
  })

  it('links somam menos -> CRIAR a diferenca, identificar = true', () => {
    const p = planejarLinha(linha({ links: ['a'] }), CORTE, false, [{ bank_ref: 'a', amount: 6000 }])
    expect(p).toEqual({ acao: 'CRIAR', valor_centavos: 4000, refs_ligadas: ['a'], identificar: true })
  })

  it('links somam mais -> CRIAR a diferenca negativa, identificar = false', () => {
    const p = planejarLinha(linha({ links: ['a'] }), CORTE, false, [{ bank_ref: 'a', amount: 12500 }])
    expect(p).toEqual({ acao: 'CRIAR', valor_centavos: -2500, refs_ligadas: ['a'], identificar: false })
  })

  it('link inexistente no ERP e tratado como ausente', () => {
    const p = planejarLinha(linha({ links: ['a', 'x'] }), CORTE, false, [{ bank_ref: 'a', amount: 10000 }])
    expect(p).toEqual({ acao: 'LIGAR', refs: ['a'] })
    const q = planejarLinha(linha({ links: ['x'] }), CORTE, false, [])
    expect(q).toEqual({ acao: 'CRIAR', valor_centavos: 10000, refs_ligadas: [], identificar: false })
  })

  it('sem links -> CRIAR valor total, identificar = false', () => {
    expect(planejarLinha(linha(), CORTE, false, [])).toEqual({
      acao: 'CRIAR', valor_centavos: 10000, refs_ligadas: [], identificar: false,
    })
  })

  it('saida (valor < 0) -> CRIAR valor negativo', () => {
    expect(planejarLinha(linha({ valor_centavos: -3500 }), CORTE, false, [])).toEqual({
      acao: 'CRIAR', valor_centavos: -3500, refs_ligadas: [], identificar: false,
    })
  })
})

describe('classificar', () => {
  const regras = [
    { id: 'r1', pattern: 'AQUALIFE', direction: 'OUT', account_id: null, category_id: 'cat-retirada', priority: 100 },
    { id: 'r2', pattern: 'BANCO INTER S A', direction: 'OUT', account_id: null, category_id: 'cat-transf', priority: 100 },
    { id: 'r3', pattern: 'GOOGLE ADS', direction: 'OUT', account_id: null, category_id: 'cat-anuncios', priority: 100 },
  ]

  it('PIX ENVIADO AQUALIFE DIVE (OUT) -> Retirada Socios', () => {
    const r = classificar(linha({ descricao: 'PIX ENVIADO AQUALIFE DIVE', valor_centavos: -5000 }), regras, 'acc')
    expect(r).toEqual({ category_id: 'cat-retirada', regra_id: 'r1' })
  })

  it('Transacao via Pix com QR Code para BANCO INTER S A (OUT) -> Transferencia entre contas', () => {
    const r = classificar(
      linha({ descricao: 'Transação via Pix com QR Code para BANCO INTER S A', valor_centavos: -5000 }), regras, 'acc')
    expect(r.category_id).toBe('cat-transf')
  })

  it('Google ADS8064036062 (OUT) -> Anuncios', () => {
    const r = classificar(linha({ descricao: 'Google ADS8064036062', valor_centavos: -5000 }), regras, 'acc')
    expect(r.category_id).toBe('cat-anuncios')
  })

  it('casa tambem pela contraparte', () => {
    const r = classificar(linha({ descricao: 'PIX', contraparte: 'Aqualife Ltda', valor_centavos: -1 }), regras, 'acc')
    expect(r.category_id).toBe('cat-retirada')
  })

  it('regra OUT nao pega entrada', () => {
    const r = classificar(linha({ descricao: 'PIX AQUALIFE', valor_centavos: 5000 }), regras, 'acc')
    expect(r).toEqual({ category_id: null, regra_id: null })
  })

  it('direction null pega entrada e saida', () => {
    const rs = [{ id: 'r', pattern: 'X', direction: null, account_id: null, category_id: 'c', priority: 100 }]
    expect(classificar(linha({ descricao: 'X', valor_centavos: 5 }), rs, 'acc').category_id).toBe('c')
    expect(classificar(linha({ descricao: 'X', valor_centavos: -5 }), rs, 'acc').category_id).toBe('c')
  })

  it('account_id: so vale para a conta indicada', () => {
    const rs = [{ id: 'r', pattern: 'X', direction: null, account_id: 'acc-1', category_id: 'c', priority: 100 }]
    expect(classificar(linha({ descricao: 'X' }), rs, 'acc-1').category_id).toBe('c')
    expect(classificar(linha({ descricao: 'X' }), rs, 'acc-2').category_id).toBeNull()
  })

  it('pattern com * e literal (sem regex)', () => {
    const rs = [{ id: 'r', pattern: 'MICROSOFT*ADS', direction: 'OUT', account_id: null, category_id: 'c', priority: 100 }]
    expect(classificar(linha({ descricao: 'MICROSOFT*ADS 123', valor_centavos: -1 }), rs, 'a').category_id).toBe('c')
    expect(classificar(linha({ descricao: 'MICROSOFT ADS 123', valor_centavos: -1 }), rs, 'a').category_id).toBeNull()
  })

  it('nenhuma regra -> category_id null', () => {
    expect(classificar(linha({ descricao: 'NADA', valor_centavos: -1 }), regras, 'acc')).toEqual({
      category_id: null, regra_id: null,
    })
  })

  it('duas regras -> menor priority vence; empate fica a primeira', () => {
    const rs = [
      { id: 'a', pattern: 'FOO', direction: null, account_id: null, category_id: 'ca', priority: 100 },
      { id: 'b', pattern: 'FOO', direction: null, account_id: null, category_id: 'cb', priority: 10 },
      { id: 'c', pattern: 'FOO', direction: null, account_id: null, category_id: 'cc', priority: 10 },
    ]
    expect(classificar(linha({ descricao: 'foo' }), rs, 'acc')).toEqual({ category_id: 'cb', regra_id: 'b' })
  })
})

describe('escolherOrfao', () => {
  const cand = (id: string, transaction_date: string, p: Record<string, unknown> = {}) => ({
    id,
    amount: 10000,
    transaction_type: 'CREDIT' as const,
    transaction_date,
    ...p,
  })
  // linha() tem data 2026-10-30 e valor +10000

  it('mesmo valor, sinal e data -> id', () => {
    expect(escolherOrfao(linha(), [cand('a', '2026-10-30')])).toBe('a')
  })
  it('data -3 e +1 aceitas', () => {
    expect(escolherOrfao(linha(), [cand('a', '2026-10-27')])).toBe('a')
    expect(escolherOrfao(linha(), [cand('b', '2026-10-31')])).toBe('b')
  })
  it('data -4 e +2 recusadas', () => {
    expect(escolherOrfao(linha(), [cand('a', '2026-10-26')])).toBeNull()
    expect(escolherOrfao(linha(), [cand('b', '2026-11-01')])).toBeNull()
  })
  it('sinal oposto recusado (CREDIT x linha negativa e DEBIT x linha positiva)', () => {
    expect(escolherOrfao(linha(), [cand('a', '2026-10-30', { transaction_type: 'DEBIT' })])).toBeNull()
    expect(escolherOrfao(linha({ valor_centavos: -10000 }), [cand('a', '2026-10-30')])).toBeNull()
    expect(
      escolherOrfao(linha({ valor_centavos: -10000 }), [cand('a', '2026-10-30', { transaction_type: 'DEBIT' })]),
    ).toBe('a')
  })
  it('valor diferente recusado', () => {
    expect(escolherOrfao(linha(), [cand('a', '2026-10-30', { amount: 10001 })])).toBeNull()
  })
  it('dois candidatos -> o de data mais proxima; empate -> o primeiro', () => {
    expect(escolherOrfao(linha(), [cand('longe', '2026-10-28'), cand('perto', '2026-10-29')])).toBe('perto')
    expect(escolherOrfao(linha(), [cand('x', '2026-10-29'), cand('y', '2026-10-31')])).toBe('x')
    expect(escolherOrfao(linha(), [cand('y', '2026-10-31'), cand('x', '2026-10-29')])).toBe('y')
  })
  it('lista vazia -> null', () => {
    expect(escolherOrfao(linha(), [])).toBeNull()
  })
})

describe('limitesJanelaOrfao', () => {
  it('data-3 .. data+1 em UTC', () => {
    const { de, ate } = limitesJanelaOrfao('2026-10-30')
    expect(de.toISOString()).toBe('2026-10-27T00:00:00.000Z')
    expect(ate.toISOString()).toBe('2026-10-31T00:00:00.000Z')
  })
})

describe('creditoUsavelParaVinculo', () => {
  const limite = new Date('2026-10-29T20:00:00.000Z')
  const c = (p: { created_at?: Date | null; source_text?: string | null }) => ({
    created_at: new Date('2026-10-30T10:00:00.000Z') as Date | null,
    source_text: null as string | null,
    ...p,
  })
  it('criado depois do ajuste -> usável', () => {
    expect(creditoUsavelParaVinculo(c({}), 'k1', limite)).toBe(true)
  })
  it('criado antes do ajuste -> ausente', () => {
    expect(creditoUsavelParaVinculo(c({ created_at: new Date('2026-10-29T10:00:00.000Z') }), 'k1', limite)).toBe(false)
  })
  it('criado exatamente no limite -> ausente', () => {
    expect(creditoUsavelParaVinculo(c({ created_at: limite }), 'k1', limite)).toBe(false)
  })
  it('created_at nulo -> ausente', () => {
    expect(creditoUsavelParaVinculo(c({ created_at: null }), 'k1', limite)).toBe(false)
  })
  it('LIGADA de outra chave -> ausente; da mesma chave -> usável', () => {
    expect(creditoUsavelParaVinculo(c({ source_text: 'LIGADA:k2' }), 'k1', limite)).toBe(false)
    expect(creditoUsavelParaVinculo(c({ source_text: 'LIGADA:k1' }), 'k1', limite)).toBe(true)
  })
  it('source_text qualquer não-LIGADA -> usável', () => {
    expect(creditoUsavelParaVinculo(c({ source_text: 'x' }), 'k1', limite)).toBe(true)
  })
})
