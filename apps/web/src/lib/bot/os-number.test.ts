import { describe, it, expect } from 'vitest'
import { resolveNewOsMin } from './os-number'

// Piso de OS "nova" (não-legada) por empresa. Auditoria 27/06: 3 rotas de bot
// hardcodavam 60000 (regra PT) → rejeitavam TODA OS da Imprimitech (começa em 6000).
describe('resolveNewOsMin', () => {
  it('usa o setting quando presente e válido', () => {
    expect(resolveNewOsMin('55000', 'pontualtech-001')).toBe(55000)
    expect(resolveNewOsMin('6000', 'imprimitech-001')).toBe(6000)
  })
  it('sem setting: imprimitech → 6000', () => {
    expect(resolveNewOsMin(null, 'imprimitech-001')).toBe(6000)
    expect(resolveNewOsMin(undefined, 'imprimitech')).toBe(6000)
  })
  it('sem setting: pontualtech / outras → 60000', () => {
    expect(resolveNewOsMin(null, 'pontualtech-001')).toBe(60000)
    expect(resolveNewOsMin(null, 'techfix')).toBe(60000)
  })
  it('setting inválido cai no fallback do slug', () => {
    expect(resolveNewOsMin('abc', 'imprimitech-001')).toBe(6000)
    expect(resolveNewOsMin('', 'pontualtech-001')).toBe(60000)
  })
  it('slug ausente → default seguro 60000 (não vaza OS legada)', () => {
    expect(resolveNewOsMin(null, null)).toBe(60000)
    expect(resolveNewOsMin(null, undefined)).toBe(60000)
  })
})
