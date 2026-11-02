import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/payments/factory', () => ({ getPaymentProvider: () => ({ validateWebhook: () => true }) }))
vi.mock('@/lib/payments/capture-fees', () => ({ captureFeesForPayment: vi.fn(async () => ({ ok: true, fees_count: 0 })) }))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'

const ACC = 'asaas1'
const evento = async (id: string, event: string, extra: Record<string, unknown> = {}) => {
  const res = await POST(new NextRequest('http://x/api/webhooks/payment', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, event, payment: { id: 'pay_1', value: 1000, netValue: 970, paymentDate: '2026-11-01', creditDate: '2026-11-01', ...extra } }),
  }))
  return res.status
}
const comRef = (ref: string) => banco.tabelas.transaction.filter((t) => t.bank_ref === ref || t.linked_ref === ref)

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  banco.reset()
  banco.conta({ id: ACC, name: 'Asaas', current_balance: 97000 })
  banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, total_amount: 100000, received_amount: 100000, description: 'OS 1' })
})

describe('webhook Asaas — "já lançado" vale também para o lançamento convertido pelo livro (onda 4, fix 1)', () => {
  it('controle: RECEIVED sem crédito ainda → cria o CREDIT pay_1 (líquido) e soma no saldo', async () => {
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'CONFIRMED', amount: 100000, billing_type: 'PIX' })
    expect(await evento('evt_1', 'PAYMENT_RECEIVED')).toBe(200)
    expect(comRef('pay_1')).toEqual([expect.objectContaining({ bank_ref: 'pay_1', transaction_type: 'CREDIT', amount: 97000 })])
    expect(banco.saldo(ACC)).toBe(194000)
  })

  it('RECEIVED de novo (DISPUTED → RECEIVED) depois que o livro converteu o crédito (linked_ref pay_1): não cria 2º crédito', async () => {
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'DISPUTED', amount: 100000, billing_type: 'CREDIT_CARD' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 97000, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_1', linked_ref: 'pay_1' })
    expect(await evento('evt_2', 'PAYMENT_RECEIVED')).toBe(200)
    expect(comRef('pay_1')).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(97000)
  })

  it('REFUNDED de novo depois que o livro converteu o débito do estorno (linked_ref pay_1-refund): não debita 2x', async () => {
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'REFUND_PENDING', amount: 100000, billing_type: 'PIX' })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 100000, origin: 'BANCO', bank_ref: 'ASAAS:x|ESTORNO|-100000|1', linked_ref: 'pay_1-refund' })
    expect(await evento('evt_3', 'PAYMENT_REFUNDED')).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.transaction_type === 'DEBIT')).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(97000)
  })

  it('chargeback revertido de novo depois que o livro converteu o débito (linked_ref pay_1-chargeback): não debita 2x', async () => {
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'DISPUTED', amount: 100000, billing_type: 'CREDIT_CARD' })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 100000, origin: 'BANCO', bank_ref: 'ASAAS:y|CHARGEBACK|-100000|1', linked_ref: 'pay_1-chargeback' })
    expect(await evento('evt_4', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL')).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.transaction_type === 'DEBIT')).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(97000)
  })
})
