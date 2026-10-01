import { describe, it, expect } from 'vitest'
import { codigoIbgeCapitalSPPorCep } from './cep-municipio'

describe('codigoIbgeCapitalSPPorCep', () => {
  it('CEP da capital (zona leste) retorna 3550308', () => {
    expect(codigoIbgeCapitalSPPorCep('03965005')).toBe('3550308')
  })

  it('aceita CEP com máscara', () => {
    expect(codigoIbgeCapitalSPPorCep('03965-005')).toBe('3550308')
  })

  it('cobre as duas faixas da capital (01000-05999 e 08000-08499)', () => {
    expect(codigoIbgeCapitalSPPorCep('01001000')).toBe('3550308')
    expect(codigoIbgeCapitalSPPorCep('05999999')).toBe('3550308')
    expect(codigoIbgeCapitalSPPorCep('08000000')).toBe('3550308')
    expect(codigoIbgeCapitalSPPorCep('08499999')).toBe('3550308')
  })

  it('fora da capital retorna undefined (Guarulhos, ABC, Ferraz, Campinas)', () => {
    expect(codigoIbgeCapitalSPPorCep('07000000')).toBeUndefined() // Guarulhos
    expect(codigoIbgeCapitalSPPorCep('09910710')).toBeUndefined() // Diadema
    expect(codigoIbgeCapitalSPPorCep('08500000')).toBeUndefined() // Ferraz de Vasconcelos
    expect(codigoIbgeCapitalSPPorCep('13000000')).toBeUndefined() // Campinas
  })

  it('CEP vazio/inválido retorna undefined', () => {
    expect(codigoIbgeCapitalSPPorCep(undefined)).toBeUndefined()
    expect(codigoIbgeCapitalSPPorCep(null)).toBeUndefined()
    expect(codigoIbgeCapitalSPPorCep('')).toBeUndefined()
    expect(codigoIbgeCapitalSPPorCep('123')).toBeUndefined()
  })
})
