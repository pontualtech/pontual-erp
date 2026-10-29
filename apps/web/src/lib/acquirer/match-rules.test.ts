import { describe, it, expect } from 'vitest'
import { novoEstadoReceivable, ehTaxaEstimadaDaOS, refsCreditoAdquirente, planoTaxas } from './match-rules'

describe('novoEstadoReceivable — status da AR ao casar venda da maquininha (Karlão 29/10)', () => {
  const ar = (o: Partial<{ status: string; reconciled: boolean; received_amount: number; total_amount: number }>) =>
    ({ status: 'PENDENTE', reconciled: false, received_amount: 0, total_amount: 29000, ...o })

  it('AR já RECEBIDO + crédito confirmado no banco → LIQUIDADO, sem somar recebido de novo', () => {
    expect(novoEstadoReceivable(ar({ status: 'RECEBIDO', received_amount: 29000 }), 29000, 'DEBIT_CARD', true))
      .toEqual({ status: 'LIQUIDADO', reconciled: true, charge_status: 'RECEIVED' })
  })

  it('AR já RECEBIDO sem confirmação do banco (match manual na tela) → só concilia, status não muda', () => {
    expect(novoEstadoReceivable(ar({ status: 'RECEBIDO', received_amount: 29000 }), 29000, 'DEBIT_CARD', false))
      .toEqual({ reconciled: true, charge_status: 'RECEIVED' })
  })

  it('AR PENDENTE quitada pela venda + banco confirmou → LIQUIDADO com recebido', () => {
    expect(novoEstadoReceivable(ar({}), 29000, 'CREDIT_CARD', true))
      .toEqual({ received_amount: 29000, status: 'LIQUIDADO', charge_status: 'RECEIVED', payment_method: 'CREDIT_CARD', reconciled: true })
  })

  it('AR PENDENTE quitada pela venda sem banco → RECEBIDO (comportamento antigo)', () => {
    expect(novoEstadoReceivable(ar({}), 29000, 'CREDIT_CARD', false))
      .toEqual({ received_amount: 29000, status: 'RECEBIDO', charge_status: 'RECEIVED', payment_method: 'CREDIT_CARD', reconciled: true })
  })

  it('venda menor que a AR → PARCIAL, nunca liquida', () => {
    expect(novoEstadoReceivable(ar({}), 10000, 'CREDIT_CARD', true))
      .toEqual({ received_amount: 10000, status: 'PARCIAL', charge_status: 'RECEIVED', payment_method: 'CREDIT_CARD' })
  })
})

describe('ehTaxaEstimadaDaOS — a taxa estimada criada na entrega (não pode ficar em dobro com a real)', () => {
  it('reconhece as duas grafias da entrega (ERP e app do motorista), em qualquer caixa', () => {
    expect(ehTaxaEstimadaDaOS('Taxa cartão OS-62873 — Cartão Débito', 62873)).toBe(true)
    expect(ehTaxaEstimadaDaOS('TAXA CARTÃO OS-62873 — CARTÃO DÉBITO', 62873)).toBe(true)
    expect(ehTaxaEstimadaDaOS('Taxa cartao OS-62873 — CREDIT_CARD 3x', 62873)).toBe(true)
  })
  it('não confunde com outra OS nem com a taxa real da Rede', () => {
    expect(ehTaxaEstimadaDaOS('Taxa cartão OS-62874 — Cartão Débito', 62873)).toBe(false)
    expect(ehTaxaEstimadaDaOS('Taxa cartão OS-628730 — Cartão Débito', 62873)).toBe(false)
    expect(ehTaxaEstimadaDaOS('MDR REDE — MASTERCARD DEBITO — OS-62873 — 0.79%', 62873)).toBe(false)
    expect(ehTaxaEstimadaDaOS(null, 62873)).toBe(false)
  })
})

describe('planoTaxas — taxa real da Rede × taxa estimada da entrega (nunca em dobro)', () => {
  const ap = (id: string, description: string, status: string) => ({ id, description, status })
  it('estimada PENDENTE → cancela e lança a real', () => {
    expect(planoTaxas([ap('a', 'TAXA CARTÃO OS-62873 — CARTÃO DÉBITO', 'PENDENTE'), ap('b', 'Peça OS-62873', 'PENDENTE')], 62873))
      .toEqual({ cancelar: ['a'], lancarReal: true })
  })
  it('estimada já PAGA por alguém → não lança a real (seria dobro) e não mexe na paga', () => {
    expect(planoTaxas([ap('a', 'Taxa cartao OS-62873 — CREDIT_CARD 3x', 'PAGO')], 62873))
      .toEqual({ cancelar: [], lancarReal: false })
  })
  it('sem estimada → só lança a real', () => {
    expect(planoTaxas([], 62873)).toEqual({ cancelar: [], lancarReal: true })
  })
})

describe('refsCreditoAdquirente — créditos da maquininha já lançados para a AR', () => {
  it('monta o bank_ref que o performMatch grava (acquirer:<provider>:<NSU>)', () => {
    expect(refsCreditoAdquirente([{ provider: 'rede', external_id: '185457004' }, { provider: 'asaas', external_id: 'pay_1' }, { provider: 'rede', external_id: null }]))
      .toEqual(['acquirer:rede:185457004'])
  })
})
