import { describe, it, expect } from 'vitest'
import { isFollowUpAllowedForChannel } from './followup-policy'

describe('isFollowUpAllowedForChannel', () => {
  it('WhatsApp oficial (Meta Cloud) nunca recebe follow-up — restrição por spam 09/10/2026', () => {
    expect(isFollowUpAllowedForChannel('Channel::Whatsapp')).toBe(false)
  })

  it('canal API (WhatsApp via Evolution) também bloqueado', () => {
    expect(isFollowUpAllowedForChannel('Channel::Api')).toBe(false)
  })

  it('chat do site e e-mail continuam podendo', () => {
    expect(isFollowUpAllowedForChannel('Channel::WebWidget')).toBe(true)
    expect(isFollowUpAllowedForChannel('Channel::Email')).toBe(true)
  })

  it('canal desconhecido ou vazio bloqueia (lado seguro)', () => {
    expect(isFollowUpAllowedForChannel('')).toBe(false)
    expect(isFollowUpAllowedForChannel(undefined)).toBe(false)
    expect(isFollowUpAllowedForChannel('Channel::Telegram')).toBe(false)
  })
})
