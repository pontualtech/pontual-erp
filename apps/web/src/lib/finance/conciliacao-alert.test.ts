import { describe, it, expect } from 'vitest'
import { receivableAlertLevel } from './conciliacao-alert'

// Controle detective (caso OS 61857 / auditoria 01/09): recebiveis DECLARADOS
// como recebidos na entrega mas nunca conciliados no extrato ficam "confirmados"
// sem lastro — porta do golpe do comprovante. Este helper classifica o que
// merece alerta semanal ao financeiro. Regra: so alerta se DECLARADO recebido,
// NAO conciliado, com valor, e velho (>=7d). Pagamento confirmado pelo provedor
// (Asaas) tira do alerta. PIX/boleto/transferencia sem lastro = ALTO (cara de
// golpe); cartao/dinheiro = WATCH (conferir Rede/caixa).
const base = {
  status: 'RECEBIDO',
  reconciled: false,
  received_amount: 64533,
  deleted_at: null as Date | null,
  created_at: new Date('2026-08-01T12:00:00Z'), // ~30d antes do NOW abaixo
  payment_method: 'PIX',
}
const NOW = new Date('2026-09-01T12:00:00Z').getTime()

describe('receivableAlertLevel', () => {
  it('SKIP quando nao se qualifica', () => {
    expect(receivableAlertLevel({ ...base, deleted_at: new Date() }, false, NOW)).toBe('skip')
    expect(receivableAlertLevel({ ...base, status: 'PENDENTE' }, false, NOW)).toBe('skip')
    expect(receivableAlertLevel({ ...base, status: 'CANCELADO' }, false, NOW)).toBe('skip')
    expect(receivableAlertLevel({ ...base, reconciled: true }, false, NOW)).toBe('skip')
    expect(receivableAlertLevel({ ...base, received_amount: 0 }, false, NOW)).toBe('skip')
    // novo demais (5 dias)
    expect(receivableAlertLevel({ ...base, created_at: new Date(NOW - 5 * 86400000) }, false, NOW)).toBe('skip')
  })
  it('SKIP quando tem pagamento confirmado no provedor (lastro real)', () => {
    expect(receivableAlertLevel(base, true, NOW)).toBe('skip')
  })
  it('tolera campos null do Prisma sem quebrar (skip)', () => {
    expect(receivableAlertLevel({ ...base, status: null }, false, NOW)).toBe('skip')
    expect(receivableAlertLevel({ ...base, created_at: null }, false, NOW)).toBe('skip')
    expect(receivableAlertLevel({ ...base, reconciled: null, received_amount: null }, false, NOW)).toBe('skip')
  })
  it('HIGH: PIX/boleto/transferencia declarado, sem lastro, velho (cara de golpe)', () => {
    expect(receivableAlertLevel({ ...base, payment_method: 'PIX' }, false, NOW)).toBe('high')
    expect(receivableAlertLevel({ ...base, payment_method: 'Boleto' }, false, NOW)).toBe('high')
    expect(receivableAlertLevel({ ...base, payment_method: 'Transferencia' }, false, NOW)).toBe('high')
    expect(receivableAlertLevel({ ...base, status: 'LIQUIDADO' }, false, NOW)).toBe('high')
    expect(receivableAlertLevel({ ...base, status: 'PAGO' }, false, NOW)).toBe('high')
  })
  it('WATCH: cartao/dinheiro declarado sem conciliar (conferir Rede/caixa, nao golpe)', () => {
    expect(receivableAlertLevel({ ...base, payment_method: 'Cartao de Credito' }, false, NOW)).toBe('watch')
    expect(receivableAlertLevel({ ...base, payment_method: 'CREDIT_CARD' }, false, NOW)).toBe('watch')
    expect(receivableAlertLevel({ ...base, payment_method: 'Dinheiro' }, false, NOW)).toBe('watch')
    expect(receivableAlertLevel({ ...base, payment_method: null }, false, NOW)).toBe('watch')
  })
})
