import { describe, it, expect } from 'vitest'
import { hasOptOutKeyword } from './opt-out'

describe('hasOptOutKeyword', () => {
  it('NÃO casa keyword como substring dentro de outra palavra (o bug)', () => {
    expect(hasOptOutKeyword('meu aparelho não liga', ['pare'])).toBe(false) // 'pare' ⊂ 'aparelho'
    expect(hasOptOutKeyword('aparelho', ['pare'])).toBe(false)
    expect(hasOptOutKeyword('comprei um separador', ['parar'])).toBe(false) // 'parar'? não; 'separador' não contém 'parar'
  })
  it('casa keyword como palavra inteira (case-insensitive)', () => {
    expect(hasOptOutKeyword('pare', ['pare'])).toBe(true)
    expect(hasOptOutKeyword('quero cancelar', ['cancelar'])).toBe(true)
    expect(hasOptOutKeyword('PARE de enviar', ['pare'])).toBe(true)
    expect(hasOptOutKeyword('não quero mais mensagens', ['não quero'])).toBe(true)
  })
  it('bordas de pontuação contam', () => {
    expect(hasOptOutKeyword('pare!', ['pare'])).toBe(true)
    expect(hasOptOutKeyword('..pare..', ['pare'])).toBe(true)
  })
  it('vazio / sem keywords → false', () => {
    expect(hasOptOutKeyword('', ['pare'])).toBe(false)
    expect(hasOptOutKeyword('pare', [])).toBe(false)
    expect(hasOptOutKeyword('pare', [''])).toBe(false)
  })
})
