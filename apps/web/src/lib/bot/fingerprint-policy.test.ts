import { describe, it, expect } from 'vitest'
import { shouldRunFingerprint, attributionForPrecision } from './fingerprint-policy'

const base = { isWhatsappChannel: true, isSupportBot: false, hasAttribution: false, conversationExists: false }

describe('shouldRunFingerprint', () => {
  it('1ª mensagem de conversa nova da Ana no WhatsApp, sem origem → roda', () => {
    expect(shouldRunFingerprint(base)).toBe(true)
  })
  it('mensagem 2 em diante (conversa já tem linha) → NÃO roda: clique livre agora é posterior ao início da conversa', () => {
    expect(shouldRunFingerprint({ ...base, conversationExists: true })).toBe(false)
  })
  it('origem já gravada (coluna durável) → NÃO roda de novo (era o bug: reatribuía conversas em andamento)', () => {
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
    expect(attributionForPrecision(attr, 'exact', 'google_ads')).toEqual(attr)
  })
  it('vários cliques possíveis: tira os IDs de clique (não vão para o Google), mantém utm', () => {
    expect(attributionForPrecision(attr, 'channel', 'google_ads')).toEqual({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: '123' })
  })
  it('anúncio só com auto-tagging (sem utm): o canal não some dos relatórios', () => {
    expect(attributionForPrecision({ gclid: 'G' }, 'channel', 'google_ads')).toEqual({ utm_source: 'google', utm_medium: 'cpc' })
    expect(attributionForPrecision({ msclkid: 'M' }, 'channel', 'microsoft_ads')).toEqual({ utm_source: 'bing', utm_medium: 'cpc' })
  })
})
