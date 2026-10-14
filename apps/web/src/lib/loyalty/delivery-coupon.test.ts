import { describe, it, expect, vi } from 'vitest'

vi.mock('@pontual/db', () => ({ prisma: {} }))

import { couponPercent, DEFAULT_COUPON_PERCENT } from './delivery-coupon'

describe('couponPercent', () => {
  it('sem setting usa o padrão de 10%', () => {
    expect(couponPercent(undefined)).toBe(DEFAULT_COUPON_PERCENT)
    expect(couponPercent(null)).toBe(DEFAULT_COUPON_PERCENT)
  })
  it('respeita o valor configurado', () => {
    expect(couponPercent('15')).toBe(15)
  })
  it('limita a 50% e trata lixo/zero como padrão', () => {
    expect(couponPercent('90')).toBe(50)
    expect(couponPercent('abc')).toBe(DEFAULT_COUPON_PERCENT)
    expect(couponPercent('0')).toBe(DEFAULT_COUPON_PERCENT)
    expect(couponPercent('-5')).toBe(DEFAULT_COUPON_PERCENT)
  })
})
