import { describe, it, expect } from 'vitest'
import { isReceivableSettled, TERMINAL_RECEIVABLE_STATUSES } from './receivable-status'

// Guard central contra double-credit. Ver auditoria 27/06: o status 'RECEBIDO'
// sozinho não basta — bulk-reconcile promove RECEBIDO→LIQUIDADO e há linhas
// legadas 'PAGO'. Creditar received_amount de novo nesses casos = receita fantasma.
describe('isReceivableSettled', () => {
  it('status terminal RECEBIDO/LIQUIDADO/PAGO → quitado (não creditar de novo)', () => {
    expect(isReceivableSettled({ status: 'RECEBIDO' })).toBe(true)
    expect(isReceivableSettled({ status: 'LIQUIDADO' })).toBe(true) // o bug: escapava antes
    expect(isReceivableSettled({ status: 'PAGO' })).toBe(true)      // legado
  })
  it('reconciled=true (mesmo com status não-terminal) → quitado', () => {
    expect(isReceivableSettled({ status: 'PARCIAL', reconciled: true })).toBe(true)
  })
  it('em aberto → NÃO quitado (pode creditar)', () => {
    expect(isReceivableSettled({ status: 'PENDENTE' })).toBe(false)
    expect(isReceivableSettled({ status: 'PARCIAL', reconciled: false })).toBe(false)
    expect(isReceivableSettled({ status: 'CANCELADO' })).toBe(false)
  })
  it('bordas: status ausente/null e sem reconciled → NÃO quitado', () => {
    expect(isReceivableSettled({ status: null })).toBe(false)
    expect(isReceivableSettled({})).toBe(false)
  })
  it('lista terminal exposta pra uso em queries Prisma (status: { in })', () => {
    expect(TERMINAL_RECEIVABLE_STATUSES).toEqual(['RECEBIDO', 'LIQUIDADO', 'PAGO'])
  })
})
