import { describe, it, expect } from 'vitest'
import { readConsent, isOptedOut, marketingDecision } from './consent'

const DAY = 86400000

describe('readConsent — lê whatsapp_consent do custom_data sem quebrar', () => {
  it('extrai o objeto de consent', () => {
    expect(readConsent({ whatsapp_consent: { opted_out: true, marketing: false } }))
      .toEqual({ opted_out: true, marketing: false })
  })
  it('custom_data sem consent → {}', () => {
    expect(readConsent({ outra_chave: 1 })).toEqual({})
  })
  it('null / não-objeto / array → {}', () => {
    expect(readConsent(null)).toEqual({})
    expect(readConsent('xpto')).toEqual({})
    expect(readConsent([1, 2])).toEqual({})
  })
})

describe('isOptedOut — bloqueia TODO proativo se opted_out', () => {
  it('opted_out true', () => {
    expect(isOptedOut({ whatsapp_consent: { opted_out: true } })).toBe(true)
  })
  it('opted_out false / ausente / custom_data vazio', () => {
    expect(isOptedOut({ whatsapp_consent: { opted_out: false } })).toBe(false)
    expect(isOptedOut({ whatsapp_consent: { marketing: true } })).toBe(false)
    expect(isOptedOut({})).toBe(false)
    expect(isOptedOut(null)).toBe(false)
  })
})

describe('marketingDecision — opt-in + opted_out + cap de frequencia (cap=7d)', () => {
  const now = 1_700_000_000_000
  it('opted_out bloqueia mesmo com marketing=true', () => {
    expect(marketingDecision({ marketing: true, opted_out: true }, now, 7).reason).toBe('opted_out')
  })
  it('sem opt-in (marketing!=true) bloqueia', () => {
    expect(marketingDecision({}, now, 7).reason).toBe('no_optin')
    expect(marketingDecision({ marketing: false }, now, 7).reason).toBe('no_optin')
  })
  it('opt-in sem envio anterior → permitido', () => {
    expect(marketingDecision({ marketing: true }, now, 7)).toEqual({ allowed: true, reason: 'ok' })
  })
  it('opt-in mas dentro do cap (3 dias atras, cap 7) → bloqueado por cap', () => {
    const last = new Date(now - 3 * DAY).toISOString()
    expect(marketingDecision({ marketing: true, last_marketing_at: last }, now, 7).reason).toBe('cap')
  })
  it('opt-in e fora do cap (8 dias atras) → permitido', () => {
    const last = new Date(now - 8 * DAY).toISOString()
    expect(marketingDecision({ marketing: true, last_marketing_at: last }, now, 7)).toEqual({ allowed: true, reason: 'ok' })
  })
})
