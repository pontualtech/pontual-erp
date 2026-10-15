import { describe, it, expect } from 'vitest'
import { COMO_CONHECEU_OPTIONS, normalizeComoConheceu } from './como-conheceu'

describe('normalizeComoConheceu', () => {
  it('aceita todas as opções da lista', () => {
    for (const o of COMO_CONHECEU_OPTIONS) expect(normalizeComoConheceu(o.key)).toBe(o.key)
  })
  it('descarta valor fora da lista, vazio e tipos errados', () => {
    expect(normalizeComoConheceu('tiktok')).toBeNull()
    expect(normalizeComoConheceu('')).toBeNull()
    expect(normalizeComoConheceu(undefined)).toBeNull()
    expect(normalizeComoConheceu(1)).toBeNull()
    expect(normalizeComoConheceu({ key: 'google' })).toBeNull()
  })
  // 2026-10-15: 1ª OS vinda da campanha de e-mail (OS 62928) não tinha opção para registrar a origem.
  it('aceita a origem "e-mail da PontualTech"', () => {
    expect(normalizeComoConheceu('email')).toBe('email')
    expect(COMO_CONHECEU_OPTIONS.find(o => o.key === 'email')?.label).toBe('E-mail da PontualTech')
  })
  it('tem a saída honesta para quando o cliente não sabe', () => {
    expect(COMO_CONHECEU_OPTIONS.some(o => o.key === 'nao_soube')).toBe(true)
  })
})
