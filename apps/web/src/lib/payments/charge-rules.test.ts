import { describe, it, expect } from 'vitest'
import { ACTIVE_CHARGE_STATUSES, computeChargeExpired } from './charge-rules'

const NOW = new Date('2026-10-05T12:00:00Z')
const d = (iso: string) => new Date(iso)

describe('ACTIVE_CHARGE_STATUSES', () => {
  it('cobrança ativa = PENDING ou OVERDUE (boleto vencido ainda é pagável — caso duplicatas OS 62482/61197)', () => {
    expect([...ACTIVE_CHARGE_STATUSES].sort()).toEqual(['OVERDUE', 'PENDING'])
  })
})

describe('computeChargeExpired', () => {
  it('PIX com expires_at passado expira; futuro não', () => {
    expect(computeChargeExpired({ method: 'PIX', status: 'PENDING', expires_at: d('2026-10-05T11:00:00Z') }, null, NOW)).toBe(true)
    expect(computeChargeExpired({ method: 'PIX', status: 'PENDING', expires_at: d('2026-10-05T13:00:00Z') }, null, NOW)).toBe(false)
  })

  it('BOLETO PENDING: expira 30 dias após o vencimento do AR (regra A15 preservada)', () => {
    expect(computeChargeExpired({ method: 'BOLETO', status: 'PENDING', expires_at: null }, d('2026-08-20'), NOW)).toBe(true)
    expect(computeChargeExpired({ method: 'BOLETO', status: 'PENDING', expires_at: null }, d('2026-09-25'), NOW)).toBe(false)
  })

  it('BOLETO OVERDUE: vencido há <30d segue ATIVO (bloqueia duplicata); >30d expira (libera nova)', () => {
    expect(computeChargeExpired({ method: 'BOLETO', status: 'OVERDUE', expires_at: null }, d('2026-10-01'), NOW)).toBe(false)
    expect(computeChargeExpired({ method: 'BOLETO', status: 'OVERDUE', expires_at: null }, d('2026-08-20'), NOW)).toBe(true)
  })

  it('CREDIT_CARD OVERDUE: regra dos 30d também se aplica (antes cartão nunca expirava e prendia)', () => {
    expect(computeChargeExpired({ method: 'CREDIT_CARD', status: 'OVERDUE', expires_at: null }, d('2026-08-20'), NOW)).toBe(true)
    expect(computeChargeExpired({ method: 'CREDIT_CARD', status: 'OVERDUE', expires_at: null }, d('2026-09-25'), NOW)).toBe(false)
  })

  it('CREDIT_CARD PENDING não expira (sem TTL — comportamento atual)', () => {
    expect(computeChargeExpired({ method: 'CREDIT_CARD', status: 'PENDING', expires_at: null }, d('2026-01-01'), NOW)).toBe(false)
  })

  it('sem due_date do AR, a regra dos 30d não atua', () => {
    expect(computeChargeExpired({ method: 'BOLETO', status: 'OVERDUE', expires_at: null }, null, NOW)).toBe(false)
  })
})
