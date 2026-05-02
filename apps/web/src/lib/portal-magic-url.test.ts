import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolvePortalDomain } from './portal-magic-url'

describe('resolvePortalDomain (M5)', () => {
  // Note: PORTAL_DOMAIN_BY_SLUG é loaded uma vez no module init.
  // Tests de override env precisam estar antes do primeiro import.
  // Aqui testamos só o behavior pra slugs no map base.

  it('slug pontualtech retorna domain mapeado', () => {
    expect(resolvePortalDomain('pontualtech')).toBe('portal.pontualtech.com.br')
  })

  it('slug imprimitech retorna domain mapeado', () => {
    expect(resolvePortalDomain('imprimitech')).toBe('portal.imprimitech.com.br')
  })

  it('slug desconhecido deriva portal.{slug}.com.br', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolvePortalDomain('novocliente')).toBe('portal.novocliente.com.br')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
