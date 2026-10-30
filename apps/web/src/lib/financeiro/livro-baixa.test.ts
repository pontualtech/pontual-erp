import { describe, it, expect } from 'vitest'
import { decidirBaixa, recebeCategoria } from './livro-baixa'

const base = { transaction_type: 'CREDIT' as const, origin: 'BANCO', linked_ref: null, categoria: 'Receita a identificar' }

describe('decidirBaixa', () => {
  it('usa o lançamento do livro de mesmo valor dentro da janela', () => {
    expect(decidirBaixa({ tipo: 'CREDIT', amount: 63627, data: '2026-10-30' }, null,
      [{ ...base, id: 'L1', amount: 63627, transaction_date: '2026-10-29' }])).toEqual({ usar: 'L1' })
  })
  it('cria quando o único candidato já está ligado', () => {
    expect(decidirBaixa({ tipo: 'CREDIT', amount: 63627, data: '2026-10-30' }, null,
      [{ ...base, id: 'L1', amount: 63627, transaction_date: '2026-10-29', linked_ref: 'AR:x' }])).toEqual({ criar: true })
  })
  it('automático usa lançamento já categorizado por regra (ex.: Energia) — senão o dinheiro conta 2x', () => {
    expect(decidirBaixa({ tipo: 'DEBIT', amount: 5000, data: '2026-10-30' }, null,
      [{ ...base, transaction_type: 'DEBIT', id: 'L2', amount: 5000, transaction_date: '2026-10-30', categoria: 'Energia' }])).toEqual({ usar: 'L2' })
  })
  it('automático nunca usa ajuste de caixa nem transferências', () => {
    for (const categoria of ['Ajuste de caixa', 'Transferência entre contas', 'Transferência entre empresas']) {
      expect(decidirBaixa({ tipo: 'DEBIT', amount: 5000, data: '2026-10-30' }, null,
        [{ ...base, transaction_type: 'DEBIT', id: 'L2', amount: 5000, transaction_date: '2026-10-30', categoria }])).toEqual({ criar: true })
    }
  })
  it('automático prefere fallback > mesma categoria do alvo > outras (antes da data)', () => {
    const alvo = { tipo: 'DEBIT' as const, amount: 5000, data: '2026-10-30', categoria: 'Energia' }
    const d = { ...base, transaction_type: 'DEBIT' as const, amount: 5000 }
    const outra = { ...d, id: 'O', transaction_date: '2026-10-30', categoria: 'Anúncios' }
    const mesma = { ...d, id: 'M', transaction_date: '2026-10-25', categoria: 'Energia' }
    const fallback = { ...d, id: 'F', transaction_date: '2026-10-21', categoria: 'A classificar' }
    expect(decidirBaixa(alvo, null, [outra, mesma, fallback])).toEqual({ usar: 'F' })
    expect(decidirBaixa(alvo, null, [outra, mesma])).toEqual({ usar: 'M' })
    expect(decidirBaixa(alvo, null, [outra])).toEqual({ usar: 'O' })
  })
  it('explícito continua exigindo fallback', () => {
    expect(decidirBaixa({ tipo: 'DEBIT', amount: 5000, data: '2026-10-30', categoria: 'Energia' }, 'L2',
      [{ ...base, transaction_type: 'DEBIT', id: 'L2', amount: 5000, transaction_date: '2026-10-30', categoria: 'Energia' }])).toEqual({ erro: 'Lançamento do livro já está categorizado' })
  })
  it('recebeCategoria: só linha sem categoria ou em fallback recebe a categoria da baixa', () => {
    expect(recebeCategoria('A classificar')).toBe(true)
    expect(recebeCategoria('Receita a identificar')).toBe(true)
    expect(recebeCategoria(null)).toBe(true)
    expect(recebeCategoria('Energia')).toBe(false)
  })
  it('explícito com diferença de 85 centavos é aceito', () => {
    expect(decidirBaixa({ tipo: 'CREDIT', amount: 54915, data: '2026-10-30' }, 'L3',
      [{ ...base, id: 'L3', amount: 55000, transaction_date: '2026-10-29' }])).toEqual({ usar: 'L3' })
  })
  it('explícito de outro tipo dá erro', () => {
    expect(decidirBaixa({ tipo: 'CREDIT', amount: 100, data: '2026-10-30' }, 'L4',
      [{ ...base, transaction_type: 'DEBIT', id: 'L4', amount: 100, transaction_date: '2026-10-30' }])).toHaveProperty('erro')
  })
  it('fora da janela (11 dias antes) cria', () => {
    expect(decidirBaixa({ tipo: 'CREDIT', amount: 100, data: '2026-10-30' }, null,
      [{ ...base, id: 'L5', amount: 100, transaction_date: '2026-10-19' }])).toEqual({ criar: true })
  })
  it('automático escolhe o mais próximo da data', () => {
    expect(decidirBaixa({ tipo: 'CREDIT', amount: 100, data: '2026-10-30' }, null, [
      { ...base, id: 'A', amount: 100, transaction_date: '2026-10-22' },
      { ...base, id: 'B', amount: 100, transaction_date: '2026-10-29' },
    ])).toEqual({ usar: 'B' })
  })
  it('explícito inexistente, ligado ou com diferença > R$1 dá erro', () => {
    const alvo = { tipo: 'CREDIT' as const, amount: 100, data: '2026-10-30' }
    expect(decidirBaixa(alvo, 'X', [])).toHaveProperty('erro')
    expect(decidirBaixa(alvo, 'L', [{ ...base, id: 'L', amount: 100, transaction_date: '2026-10-30', linked_ref: 'AR:y' }])).toHaveProperty('erro')
    expect(decidirBaixa(alvo, 'L', [{ ...base, id: 'L', amount: 201, transaction_date: '2026-10-30' }])).toHaveProperty('erro')
  })
})
