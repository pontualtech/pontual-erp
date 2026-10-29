import { describe, it, expect } from 'vitest'
import { estadoArConfirmado, estadoArRecebido, valorCreditoAsaas, dataCreditoAsaas } from './asaas-rules'

const ar = (o: Partial<{ status: string; received_amount: number; total_amount: number; reconciled: boolean }>) =>
  ({ status: 'PENDENTE', received_amount: 0, total_amount: 63450, reconciled: false, ...o })

describe('estadoArConfirmado — Asaas CONFIRMED: cliente pagou, dinheiro ainda NÃO disponível (Karlão 29/10)', () => {
  it('quitou → RECEBIDO, mas NÃO conciliado (concilia só quando o dinheiro cai)', () => {
    expect(estadoArConfirmado(ar({}), 63450)).toEqual({ received_amount: 63450, status: 'RECEBIDO' })
  })
  it('parcial → continua PENDENTE', () => {
    expect(estadoArConfirmado(ar({}), 10000)).toEqual({ received_amount: 10000, status: 'PENDENTE' })
  })
  it('AR já quitada → não mexe (sem soma dupla)', () => {
    expect(estadoArConfirmado(ar({ status: 'RECEBIDO', received_amount: 63450 }), 63450)).toBeNull()
  })
})

describe('estadoArRecebido — Asaas RECEIVED: dinheiro creditado na conta Asaas → LIQUIDADO', () => {
  it('AR pendente quitada de uma vez (PIX/boleto) → LIQUIDADO + conciliado', () => {
    expect(estadoArRecebido(ar({}), 63450)).toEqual({ received_amount: 63450, status: 'LIQUIDADO', reconciled: true })
  })
  it('AR que já estava RECEBIDO pelo CONFIRMED (cartão) → LIQUIDADO sem somar de novo', () => {
    expect(estadoArRecebido(ar({ status: 'RECEBIDO', received_amount: 63450 }), 63450)).toEqual({ status: 'LIQUIDADO', reconciled: true })
  })
  it('AR já LIQUIDADO → só garante conciliado', () => {
    expect(estadoArRecebido(ar({ status: 'LIQUIDADO', received_amount: 63450, reconciled: true }), 63450)).toEqual({ status: 'LIQUIDADO', reconciled: true })
  })
  it('pagamento parcial → PENDENTE, nunca liquida', () => {
    expect(estadoArRecebido(ar({}), 10000)).toEqual({ received_amount: 10000, status: 'PENDENTE' })
  })
})

describe('valorCreditoAsaas — o saldo da conta Asaas recebe o LÍQUIDO (a taxa é despesa à parte)', () => {
  it('usa netValue do Asaas', () => {
    expect(valorCreditoAsaas({ value: 634.5, netValue: 632.51 }, 63450)).toBe(63251)
  })
  it('sem netValue válido → bruto (comportamento antigo)', () => {
    expect(valorCreditoAsaas({ value: 634.5 }, 63450)).toBe(63450)
    expect(valorCreditoAsaas({ netValue: 0 }, 63450)).toBe(63450)
    expect(valorCreditoAsaas({ netValue: 900 }, 63450)).toBe(63450) // líquido maior que o bruto = dado estranho
  })
})

describe('dataCreditoAsaas — data em que o dinheiro ficou disponível', () => {
  it('prefere creditDate, depois paymentDate, sempre ao meio-dia de Brasília', () => {
    expect(dataCreditoAsaas({ creditDate: '2026-10-16', paymentDate: '2026-10-15' })?.toISOString()).toBe('2026-10-16T15:00:00.000Z')
    expect(dataCreditoAsaas({ paymentDate: '2026-10-15' })?.toISOString()).toBe('2026-10-15T15:00:00.000Z')
  })
  it('sem data válida → null (o chamador usa agora)', () => {
    expect(dataCreditoAsaas({})).toBeNull()
    expect(dataCreditoAsaas({ creditDate: 'lixo' })).toBeNull()
  })
})
