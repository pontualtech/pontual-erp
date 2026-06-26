import { describe, it, expect } from 'vitest'
import { deriveColetaPeriodo } from './coleta-periodo'

// Etiqueta de período derivada da observação livre de coleta/entrega. Best-effort:
// o texto livre é a fonte da verdade; o período é só dica de ordenação de rota.
// Quando ambíguo, retorna null (UI mostra só o texto).
describe('deriveColetaPeriodo', () => {
  it('manhã explícita → MANHA', () => {
    expect(deriveColetaPeriodo('pode ser de manhã')).toBe('MANHA')
    expect(deriveColetaPeriodo('coletar bem cedo')).toBe('MANHA')
    expect(deriveColetaPeriodo('antes do almoço')).toBe('MANHA')
  })
  it('deadline cedo (até/antes das ≤14h) → MANHA', () => {
    expect(deriveColetaPeriodo('até as 11h')).toBe('MANHA')
    expect(deriveColetaPeriodo('coletar antes das 12h')).toBe('MANHA')
    expect(deriveColetaPeriodo('só consigo receber até as 14h')).toBe('MANHA')
  })
  it('tarde explícita → TARDE', () => {
    expect(deriveColetaPeriodo('só à tarde')).toBe('TARDE')
    expect(deriveColetaPeriodo('depois do almoço')).toBe('TARDE')
    expect(deriveColetaPeriodo('no fim da tarde')).toBe('TARDE')
  })
  it('deadline tardio / sem indício → null (mostra só o texto)', () => {
    expect(deriveColetaPeriodo('coletar antes das 15h')).toBe(null)
    expect(deriveColetaPeriodo('fechado para almoço das 12 às 13')).toBe(null)
    expect(deriveColetaPeriodo('deixar na portaria')).toBe(null)
    expect(deriveColetaPeriodo('')).toBe(null)
    expect(deriveColetaPeriodo(null)).toBe(null)
  })
})
