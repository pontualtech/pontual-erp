import { describe, it, expect } from 'vitest'
import { toCents } from './rede-parser'

describe('toCents (B4 — floating-point safe)', () => {
  it('valores inteiros decimais', () => {
    expect(toCents(1)).toBe(100)
    expect(toCents(99)).toBe(9900)
    expect(toCents(1817.98)).toBe(181798)
  })

  it('valores zero/negativos/edge', () => {
    expect(toCents(0)).toBe(0)
    expect(toCents(NaN)).toBe(0)
    expect(toCents(Infinity)).toBe(0)
    expect(toCents(-Infinity)).toBe(0)
  })

  it('floating-point edge case 1.005 → 100 ou 101', () => {
    // Math.round(1.005 * 100) sem EPSILON = 100 (errado)
    // Com EPSILON, deve dar 101
    expect(toCents(1.005)).toBe(101)
  })

  it('valor negativo round half away from zero', () => {
    expect(toCents(-1.50)).toBe(-150)
    expect(toCents(-99.99)).toBe(-9999)
  })

  it('precisão em valores tipicamente bancários', () => {
    expect(toCents(0.10)).toBe(10)
    expect(toCents(0.20)).toBe(20)
    expect(toCents(0.30)).toBe(30) // 0.1 + 0.2 = 0.30000000000000004 famous bug
  })
})
