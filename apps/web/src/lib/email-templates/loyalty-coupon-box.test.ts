import { describe, it, expect } from 'vitest'
import { loyaltyCouponBoxHtml } from './loyalty-coupon-box'

describe('loyaltyCouponBoxHtml', () => {
  it('mostra o percentual do cupom', () => {
    expect(loyaltyCouponBoxHtml(10)).toContain('10% de desconto')
    expect(loyaltyCouponBoxHtml(12.6)).toContain('13% de desconto')
  })
  it('não liga o cupom a avaliação (política do Google)', () => {
    expect(loyaltyCouponBoxHtml(10)).not.toMatch(/avalia|google|review|estrela/i)
  })
})
