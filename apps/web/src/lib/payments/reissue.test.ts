import { describe, it, expect } from 'vitest'
import { isReissuablePaymentStatus } from './reissue'

describe('isReissuablePaymentStatus', () => {
  it('terminal não-pago libera reemissão (caso OS 62122: boleto DELETED no Asaas)', () => {
    for (const s of ['DELETED', 'CANCELLED', 'CANCELADO', 'EXPIRED', 'REFUNDED']) {
      expect(isReissuablePaymentStatus(s), s).toBe(true)
    }
  })

  it('ativo ou pago continua bloqueando', () => {
    for (const s of ['PENDING', 'PENDENTE', 'CONFIRMED', 'RECEIVED', 'RECEBIDO', 'LIQUIDADO']) {
      expect(isReissuablePaymentStatus(s), s).toBe(false)
    }
  })

  it('OVERDUE bloqueia (boleto vencido ainda é pagável no Asaas — reemitir criaria risco de pagamento duplo)', () => {
    expect(isReissuablePaymentStatus('OVERDUE')).toBe(false)
  })

  it('status desconhecido/vazio bloqueia (fail-safe)', () => {
    expect(isReissuablePaymentStatus('')).toBe(false)
    expect(isReissuablePaymentStatus('QUALQUER_COISA')).toBe(false)
    expect(isReissuablePaymentStatus(null)).toBe(false)
    expect(isReissuablePaymentStatus(undefined)).toBe(false)
  })
})
