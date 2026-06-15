import { describe, it, expect } from 'vitest'
import { readConsent, isOptedOut } from './consent'

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
