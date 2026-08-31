import { describe, it, expect } from 'vitest'
import { isEmojiOnlyMessage } from './emoji-only'

// Bug 2026-09 (auditoria bots): a regex antiga /^[\p{Emoji}\s]+$/u marcava
// NUMEROS como emoji — \p{Emoji} do Unicode inclui 0-9, # e * (sao "emoji
// components" de keycaps). CEP "09931280" e numero de casa "699" chegavam
// pro modelo com [HINT: cliente enviou apenas emoji/figurinha] (ruido +
// risco de resposta errada). Casos reais: convs d21b05fc, 03b3492a, 126c75a7.
describe('isEmojiOnlyMessage — emoji de verdade, nunca numeros', () => {
  it('NUMEROS nao sao emoji (o bug real)', () => {
    expect(isEmojiOnlyMessage('09931280')).toBe(false) // CEP
    expect(isEmojiOnlyMessage('699')).toBe(false)      // numero de casa
    expect(isEmojiOnlyMessage('51')).toBe(false)
    expect(isEmojiOnlyMessage('0')).toBe(false)
    expect(isEmojiOnlyMessage('123 456')).toBe(false)
    expect(isEmojiOnlyMessage('#')).toBe(false)
    expect(isEmojiOnlyMessage('*')).toBe(false)
  })
  it('emoji puro E emoji: true', () => {
    expect(isEmojiOnlyMessage('👍')).toBe(true)
    expect(isEmojiOnlyMessage('👍🏼')).toBe(true)       // tom de pele
    expect(isEmojiOnlyMessage('❤️')).toBe(true)         // variation selector
    expect(isEmojiOnlyMessage('🙏 🙏')).toBe(true)      // com espaco
    expect(isEmojiOnlyMessage('😅😂🤣')).toBe(true)
    expect(isEmojiOnlyMessage('👨‍👩‍👧')).toBe(true)   // ZWJ familia
  })
  it('texto normal: false', () => {
    expect(isEmojiOnlyMessage('ok')).toBe(false)
    expect(isEmojiOnlyMessage('obrigado 🙏')).toBe(false) // texto + emoji
    expect(isEmojiOnlyMessage('sim')).toBe(false)
    expect(isEmojiOnlyMessage('')).toBe(false)
    expect(isEmojiOnlyMessage('   ')).toBe(false)
  })
})
