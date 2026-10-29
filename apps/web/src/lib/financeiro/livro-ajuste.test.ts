import { describe, it, expect } from 'vitest'
import { calcularAjuste, dataValida } from './livro-ajuste'

describe('calcularAjuste', () => {
  it('saldo do ERP maior que o real → DEBIT da diferença', () => {
    expect(calcularAjuste(9944636, 61977066)).toEqual({ tipo: 'DEBIT', amount: 52032430 })
  })
  it('saldo do ERP menor que o real → CREDIT da diferença', () => {
    expect(calcularAjuste(100, 40)).toEqual({ tipo: 'CREDIT', amount: 60 })
  })
  it('saldos iguais → nenhum ajuste', () => {
    expect(calcularAjuste(5, 5)).toEqual({ tipo: null, amount: 0 })
  })
})

describe('dataValida', () => {
  it('aceita datas reais e rejeita impossíveis ou mal formatadas', () => {
    expect(dataValida('2026-10-29')).toBe(true)
    expect(dataValida('2024-02-29')).toBe(true)
    expect(dataValida('2026-02-31')).toBe(false)
    expect(dataValida('2026-13-01')).toBe(false)
    expect(dataValida('29/10/2026')).toBe(false)
  })
})
