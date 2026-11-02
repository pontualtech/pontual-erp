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

// F2-D (#4): a conta (accounts) é travada antes de a AR ser atualizada e antes da checagem "já lançado".
const ordemTravas = (modeloAR: string) => {
  const trava = banco.travas.find((t) => t.tabela === 'accounts')!
  expect(trava).toBeDefined()
  const primeiro = (f: (o: (typeof banco.log)[number]) => boolean) => banco.log.find(f)?.seq ?? Infinity
  expect(trava.seq).toBeLessThan(primeiro((o) => o.modelo === modeloAR && ['update', 'updateMany', 'create'].includes(o.op)))
  expect(trava.seq).toBeLessThan(primeiro((o) => o.modelo === 'transaction' && ['findFirst', 'create'].includes(o.op)))
}

describe('F2-D (#4): webhook Asaas trava a conta antes da AR', () => {
  it('RECEIVED e REFUNDED: accounts antes de accountReceivable.update e do ondeRef', async () => {
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'CONFIRMED', amount: 100000, billing_type: 'PIX' })
    await evento('evt_o1', 'PAYMENT_RECEIVED')
    expect(banco.travas[0]).toEqual(expect.objectContaining({ tabela: 'accounts', id: ACC }))
    ordemTravas('accountReceivable')
    banco.log.length = 0; banco.travas.length = 0
    await evento('evt_o2', 'PAYMENT_REFUNDED')
    ordemTravas('accountReceivable')
  })
})

describe('F3-E (#5): webhook Asaas decide pela AR relida com a trava', () => {
  it('Receber parcial de 30 comitado enquanto o RECEIVED de 70 esperava a trava → received_amount 100 e LIQUIDADO', async () => {
    banco.tabelas.accountReceivable[0] = { ...banco.tabelas.accountReceivable[0], status: 'PENDENTE', total_amount: 10000, received_amount: 0 }
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'CONFIRMED', amount: 7000, billing_type: 'PIX' })
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts') return
      Object.assign(banco.tabelas.accountReceivable[0], { received_amount: 3000 })
      banco.aoTravar(null)
    })
    expect(await evento('evt_p', 'PAYMENT_RECEIVED', { value: 70, netValue: 69 })).toBe(200)
    expect(banco.tabelas.accountReceivable[0]).toEqual(expect.objectContaining({ received_amount: 10000, status: 'LIQUIDADO' }))
    expect(banco.travas.map((t) => t.tabela)).toEqual(['accounts', 'accounts_receivable'])
  })
})

describe('F3-D (#4): webhook Asaas — opções da tx e conflito → 503', () => {
  it('$transaction com maxWait 10s e timeout 20s; P2034 → 503 "conflito; repita"', async () => {
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'CONFIRMED', amount: 100000, billing_type: 'PIX' })
    banco.tx.transaction.create.mockImplementationOnce(async () => { throw Object.assign(new Error('deadlock detected'), { code: 'P2034' }) })
    const res = await POST(new NextRequest('http://x/api/webhooks/payment', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'evt_c', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', value: 1000, netValue: 970 } }),
    }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'conflito; repita' })
    expect(banco.transacoes.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }])
  })
})
