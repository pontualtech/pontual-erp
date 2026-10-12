import { describe, it, expect } from 'vitest'
import { shouldRunFingerprint, attributionForPrecision, NEW_CONVERSATION_MAX_AGE_MS } from './fingerprint-policy'

const now = new Date('2026-10-12T14:00:00Z')
const base = { isWhatsappChannel: true, isSupportBot: false, hasAttribution: false, conversationCreatedAt: null as Date | null, now }

describe('shouldRunFingerprint', () => {
  it('conversa nova da Ana no WhatsApp, sem origem → roda', () => {
    expect(shouldRunFingerprint(base)).toBe(true)
  })
  it('conversa criada há menos de 2 min (1ª mensagem consolidada) → roda', () => {
    expect(shouldRunFingerprint({ ...base, conversationCreatedAt: new Date(now.getTime() - 60_000) })).toBe(true)
  })
  it('conversa em andamento (criada há mais de 2 min) → NÃO roda (era o bug: pescava clique de outra pessoa)', () => {
    expect(shouldRunFingerprint({ ...base, conversationCreatedAt: new Date(now.getTime() - NEW_CONVERSATION_MAX_AGE_MS - 1) })).toBe(false)
    expect(shouldRunFingerprint({ ...base, conversationCreatedAt: new Date(now.getTime() - 3 * 864e5) })).toBe(false)
  })
  it('origem já gravada (coluna durável) → NÃO roda de novo', () => {
    expect(shouldRunFingerprint({ ...base, hasAttribution: true })).toBe(false)
  })
  it('Suporte (Marta) → NÃO roda: nenhum botão do site leva ao Suporte', () => {
    expect(shouldRunFingerprint({ ...base, isSupportBot: true })).toBe(false)
  })
  it('fora do WhatsApp (e-mail, chat do site) → NÃO roda', () => {
    expect(shouldRunFingerprint({ ...base, isWhatsappChannel: false })).toBe(false)
  })
})

describe('attributionForPrecision', () => {
  const attr = { gclid: 'G', gbraid: 'B', msclkid: 'M', utm_source: 'google', utm_medium: 'cpc', utm_campaign: '123' }
  it('exato: guarda o clique inteiro', () => {
    expect(attributionForPrecision(attr, 'exact')).toEqual(attr)
  })
  it('vários cliques possíveis: guarda só canal/utm, sem IDs de clique (não vão para o Google)', () => {
    expect(attributionForPrecision(attr, 'channel')).toEqual({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: '123' })
  })
})
