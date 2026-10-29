import { describe, it, expect } from 'vitest'
import { resumirExtratoAsaas } from './asaas-extrato'

describe('resumirExtratoAsaas — cada lançamento da conta Asaas com a OS de onde veio (Karlão 29/10)', () => {
  const pagamentos = [{ external_id: 'pay_1', os_number: 62768, ar_status: 'LIQUIDADO', ar_reconciled: true }]

  it('crédito de cobrança do ERP → OS e situação da conta a receber', () => {
    expect(resumirExtratoAsaas([{ date: '2026-10-15', type: 'PAYMENT_RECEIVED', value: 634.5, description: 'Cobrança recebida', paymentId: 'pay_1' }], pagamentos))
      .toEqual([{ data: '2026-10-15', tipo: 'PAYMENT_RECEIVED', valor_centavos: 63450, descricao: 'Cobrança recebida', payment_id: 'pay_1', os: 62768, ar_status: 'LIQUIDADO', conciliado: true, alerta: null }])
  })

  it('taxa (valor negativo) da mesma cobrança também aponta a OS', () => {
    const [t] = resumirExtratoAsaas([{ date: '2026-10-15', type: 'PAYMENT_FEE', value: -1.99, description: 'Taxa', paymentId: 'pay_1' }], pagamentos)
    expect(t.valor_centavos).toBe(-199)
    expect(t.os).toBe(62768)
    expect(t.alerta).toBeNull()
  })

  it('dinheiro que entrou sem cobrança no ERP → alerta (cobrança criada no painel do Asaas?)', () => {
    const [t] = resumirExtratoAsaas([{ date: '2026-10-20', type: 'PAYMENT_RECEIVED', value: 500, description: 'x', paymentId: 'pay_9' }], pagamentos)
    expect(t.os).toBeNull()
    expect(t.alerta).toBe('entrada sem cobrança no ERP')
  })

  it('crédito do ERP cuja conta a receber não está conciliada → alerta', () => {
    const [t] = resumirExtratoAsaas([{ date: '2026-10-20', type: 'PAYMENT_RECEIVED', value: 1, paymentId: 'pay_2' }], [{ external_id: 'pay_2', os_number: 1, ar_status: 'RECEBIDO', ar_reconciled: false }])
    expect(t.alerta).toBe('dinheiro entrou mas a conta a receber não está conciliada')
  })

  it('transferência / saída sem cobrança não é alerta', () => {
    const [t] = resumirExtratoAsaas([{ date: '2026-10-21', type: 'TRANSFER', value: -1000, description: 'Transferência' }], pagamentos)
    expect(t).toMatchObject({ tipo: 'TRANSFER', valor_centavos: -100000, os: null, alerta: null })
  })
})
