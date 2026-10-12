import { describe, it, expect } from 'vitest'
import { trackingSourceFor } from './tracking-source'

describe('trackingSourceFor', () => {
  it('formulário do site com gclid no corpo → site_form (prova de 1ª mão)', () => {
    expect(trackingSourceFor({ bodyHadTracking: true, origem: 'site-pontualtech' })).toBe('site_form')
  })
  it('gclid no corpo vindo de outra origem → request_body (não é aceito como prova)', () => {
    expect(trackingSourceFor({ bodyHadTracking: true, origem: 'whatsapp' })).toBe('request_body')
    expect(trackingSourceFor({ bodyHadTracking: true })).toBe('request_body')
  })
  it('sem gclid no corpo (recuperado da conversa do bot) → bot_conversation', () => {
    expect(trackingSourceFor({ bodyHadTracking: false, origem: 'site-pontualtech' })).toBe('bot_conversation')
  })
})
