import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/payments/factory', () => ({ getPaymentProvider: () => ({ validateWebhook: () => true }) }))
vi.mock('@/lib/payments/capture-fees', () => ({ captureFeesForPayment: vi.fn(async () => ({ ok: true, fees_count: 0 })) }))
vi.mock('@/lib/observability', () => ({ logError: vi.fn(async () => undefined) }))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'
import { logError } from '@/lib/observability'

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
  // F5-A: a busca da conta do crédito pay_ (select só account_id) escolhe QUAL conta travar — vem antes da trava, como a
  // leitura de fora das rotas do §7; a checagem "já lançado" e as escritas vêm depois.
  const escolheConta = (o: (typeof banco.log)[number]) => JSON.stringify(o.args?.select) === JSON.stringify({ account_id: true })
  expect(trava.seq).toBeLessThan(primeiro((o) => o.modelo === 'transaction' && ['findFirst', 'create'].includes(o.op) && !escolheConta(o)))
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

  it('m11: reversão de chargeback (AWAITING_CHARGEBACK_REVERSAL): accounts antes da AR e do DEBIT', async () => {
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'DISPUTED', amount: 100000, billing_type: 'CREDIT_CARD' })
    await evento('evt_o3', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL')
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'pay_1-chargeback')).toHaveLength(1)
    expect(banco.travas[0]).toEqual(expect.objectContaining({ tabela: 'accounts', id: ACC }))
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

describe('F4-D (#5, m4, m13): webhook Asaas decide pela AR travada e relida em todos os ramos', () => {
  // Receber concorrente comitado enquanto o webhook esperava a trava da AR.
  const comitarAoTravarAR = (campos: Record<string, unknown>) => banco.aoTravar(({ tabela }) => {
    if (tabela !== 'accounts_receivable') return
    Object.assign(banco.tabelas.accountReceivable[0], campos)
    banco.aoTravar(null)
  })

  it('#5 CONFIRMED: Receber parcial de 3000 comitado durante a espera → received_amount 10000 (não 7000)', async () => {
    Object.assign(banco.tabelas.accountReceivable[0], { status: 'PENDENTE', total_amount: 10000, received_amount: 0 })
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'PENDING', amount: 7000, billing_type: 'CREDIT_CARD' })
    comitarAoTravarAR({ received_amount: 3000 })
    expect(await evento('evt_c5', 'PAYMENT_CONFIRMED', { value: 70 })).toBe(200)
    expect(banco.tabelas.accountReceivable[0]).toEqual(expect.objectContaining({ received_amount: 10000, status: 'RECEBIDO' }))
  })

  it('m4 DELETED: recebimento parcial comitado durante a espera → mantém charge_id (não apaga o rastro)', async () => {
    Object.assign(banco.tabelas.accountReceivable[0], { status: 'PENDENTE', total_amount: 10000, received_amount: 0, charge_id: 'pay_1', charge_url: 'u' })
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'PENDING', amount: 10000, billing_type: 'PIX' })
    comitarAoTravarAR({ received_amount: 3000 })
    expect(await evento('evt_d', 'PAYMENT_DELETED')).toBe(200)
    expect(banco.tabelas.accountReceivable[0]).toEqual(expect.objectContaining({ charge_id: 'pay_1', charge_status: 'DELETED' }))
  })

  it('m13 REFUNDED: o valor revertido sai da releitura (Receber de 50000 comitado durante a espera)', async () => {
    Object.assign(banco.tabelas.accountReceivable[0], { status: 'PENDENTE', total_amount: 200000, received_amount: 100000 })
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'RECEIVED', amount: 100000, billing_type: 'PIX' })
    comitarAoTravarAR({ received_amount: 150000 })
    expect(await evento('evt_r', 'PAYMENT_REFUNDED')).toBe(200)
    expect(banco.tabelas.accountReceivable[0].received_amount).toBe(50000)
  })

  it('m13 reversão de chargeback: o valor revertido sai da releitura', async () => {
    Object.assign(banco.tabelas.accountReceivable[0], { status: 'PENDENTE', total_amount: 200000, received_amount: 100000 })
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'DISPUTED', amount: 100000, billing_type: 'CREDIT_CARD' })
    comitarAoTravarAR({ received_amount: 150000 })
    expect(await evento('evt_cb', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL')).toBe(200)
    expect(banco.tabelas.accountReceivable[0].received_amount).toBe(50000)
  })
})

describe('F4-D (#4): RECEIVED depois de um Receber manual — o dinheiro não conta 2x', () => {
  const CAIXA = '33333333-3333-4333-8333-333333333333'
  beforeEach(() => {
    vi.mocked(logError).mockClear()
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'PENDING', amount: 100000, billing_type: 'PIX' })
  })

  it('nocional AR:r1 vivo na conta do Asaas → SWAP: apaga o AR:r1 (e o saldo) e cria o pay_1 líquido; saldo final = banco', async () => {
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 100000, bank_ref: 'AR:r1' })
    banco.tabelas.account[0].current_balance = 197000 // 97000 + o Receber de 100000
    expect(await evento('evt_s1', 'PAYMENT_RECEIVED')).toBe(200)
    expect(banco.tx_('noc')).toBeUndefined()
    expect(comRef('pay_1')).toEqual([expect.objectContaining({ bank_ref: 'pay_1', amount: 97000, account_id: ACC })])
    expect(banco.saldo(ACC)).toBe(194000) // 97000 + 97000 (líquido) — o bruto do Receber saiu
    expect(banco.tabelas.accountReceivable[0]).toEqual(expect.objectContaining({ status: 'LIQUIDADO', received_amount: 100000 }))
  })

  it('nocional AR:r1 já compensado por :estorno não é trocado (o par se anula): cria o pay_1 como hoje', async () => {
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 100000, bank_ref: 'AR:r1', created_at: new Date(Date.now() - 120_000) })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 100000, bank_ref: 'AR:r1:estorno', created_at: new Date(Date.now() - 60_000) })
    expect(await evento('evt_s4', 'PAYMENT_RECEIVED')).toBe(200)
    expect(banco.tx_('noc')).toBeDefined()
    expect(comRef('pay_1')).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(194000)
  })

  it('linha BANCO ligada a AR:r1 na conta do Asaas → não cria pay_1 (o dinheiro já está), só o status', async () => {
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 97000, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_1', linked_ref: 'AR:r1' })
    expect(await evento('evt_s2', 'PAYMENT_RECEIVED')).toBe(200)
    expect(comRef('pay_1')).toEqual([])
    expect(banco.saldo(ACC)).toBe(97000)
    expect(banco.tabelas.accountReceivable[0].status).toBe('LIQUIDADO')
  })

  it('nocional AR:r1 em OUTRA conta (Caixa) → cria pay_1 como hoje e registra a possível duplicidade em error_logs', async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 100000 })
    banco.transacao({ id: 'noc', account_id: CAIXA, transaction_type: 'CREDIT', amount: 100000, bank_ref: 'AR:r1' })
    expect(await evento('evt_s3', 'PAYMENT_RECEIVED')).toBe(200)
    expect(banco.tx_('noc')).toBeDefined()
    expect(comRef('pay_1')).toEqual([expect.objectContaining({ amount: 97000, account_id: ACC })])
    expect(banco.saldo(CAIXA)).toBe(100000)
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('possível duplicidade: AR recebida manualmente em Caixa e também pelo Asaas') }),
      expect.objectContaining({ company_id: 'c1' }),
      'warning',
    )
  })

  it('controle: AR quitada sem lançamento próprio (Receber sem crédito) → cria pay_1, sem aviso', async () => {
    expect(await evento('evt_s5', 'PAYMENT_RECEIVED')).toBe(200)
    expect(comRef('pay_1')).toHaveLength(1)
    expect(logError).not.toHaveBeenCalled()
  })
})

describe('F5-A: o webhook Asaas credita/debita na conta da cobrança, não na conta da AR', () => {
  const ITAU = '44444444-4444-4444-8444-444444444444'
  const ASAAS2 = '55555555-5555-4555-8555-555555555555'
  beforeEach(() => {
    vi.mocked(logError).mockClear()
    banco.conta({ id: ITAU, name: 'ITAU PRINCIPAL', current_balance: 500000 })
    Object.assign(banco.tabelas.accountReceivable[0], { account_id: ITAU, status: 'PENDENTE', received_amount: 0 })
  })

  it('AR no Itaú com Payment metadata.account_id = conta Asaas → crédito pay_1 na conta Asaas; Itaú intocado', async () => {
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'PENDING', amount: 100000, billing_type: 'PIX', metadata: { account_id: ACC } })
    expect(await evento('evt_m1', 'PAYMENT_RECEIVED')).toBe(200)
    expect(comRef('pay_1')).toEqual([expect.objectContaining({ account_id: ACC, amount: 97000 })])
    expect([banco.saldo(ACC), banco.saldo(ITAU)]).toEqual([194000, 500000])
    expect(banco.travas.find((t) => t.tabela === 'accounts')).toEqual(expect.objectContaining({ id: ACC }))
  })

  it('metadata.account_id (da empresa) vence a conta "Asaas" genérica', async () => {
    banco.conta({ id: ASAAS2, name: 'Cobranças', current_balance: 0 })
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'PENDING', amount: 100000, billing_type: 'PIX', metadata: { account_id: ASAAS2 } })
    expect(await evento('evt_m9', 'PAYMENT_RECEIVED')).toBe(200)
    expect(comRef('pay_1')).toEqual([expect.objectContaining({ account_id: ASAAS2 })])
  })

  it('metadata ausente → a conta Asaas da empresa (não a da AR)', async () => {
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'PENDING', amount: 100000, billing_type: 'PIX' })
    expect(await evento('evt_m2', 'PAYMENT_RECEIVED')).toBe(200)
    expect(comRef('pay_1')).toEqual([expect.objectContaining({ account_id: ACC })])
    expect(banco.saldo(ITAU)).toBe(500000)
  })

  it('nenhuma conta Asaas na empresa → a conta da AR', async () => {
    banco.tabelas.account.find((a) => a.id === ACC)!.name = 'Conta Movimento'
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'PENDING', amount: 100000, billing_type: 'PIX' })
    expect(await evento('evt_m3', 'PAYMENT_RECEIVED')).toBe(200)
    expect(comRef('pay_1')).toEqual([expect.objectContaining({ account_id: ITAU })])
  })

  it('REFUNDED debita na conta do crédito pay_1 existente (nocional), não na da AR', async () => {
    Object.assign(banco.tabelas.accountReceivable[0], { status: 'LIQUIDADO', received_amount: 100000 })
    banco.conta({ id: ASAAS2, name: 'Cobranças', current_balance: 97000 })
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'RECEIVED', amount: 100000, billing_type: 'PIX' })
    banco.transacao({ account_id: ASAAS2, transaction_type: 'CREDIT', amount: 97000, bank_ref: 'pay_1' })
    expect(await evento('evt_m4', 'PAYMENT_REFUNDED')).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'pay_1-refund')).toEqual([expect.objectContaining({ account_id: ASAAS2, transaction_type: 'DEBIT', amount: 100000 })])
    expect([banco.saldo(ASAAS2), banco.saldo(ITAU), banco.saldo(ACC)]).toEqual([-3000, 500000, 97000])
  })

  it('reversão de chargeback debita na conta da linha BANCO convertida do pay_1 (linked_ref)', async () => {
    Object.assign(banco.tabelas.accountReceivable[0], { status: 'LIQUIDADO', received_amount: 100000 })
    banco.conta({ id: ASAAS2, name: 'Cobranças', current_balance: 97000 })
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'DISPUTED', amount: 100000, billing_type: 'CREDIT_CARD' })
    banco.transacao({ account_id: ASAAS2, transaction_type: 'CREDIT', amount: 97000, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_1', linked_ref: 'pay_1' })
    expect(await evento('evt_m5', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL')).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'pay_1-chargeback')).toEqual([expect.objectContaining({ account_id: ASAAS2 })])
    expect(banco.saldo(ITAU)).toBe(500000)
  })

  it('REFUNDED sem crédito pay_1 nenhum → a conta do crédito Asaas (metadata)', async () => {
    Object.assign(banco.tabelas.accountReceivable[0], { status: 'LIQUIDADO', received_amount: 100000 })
    banco.conta({ id: ASAAS2, name: 'Cobranças', current_balance: 0 })
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'RECEIVED', amount: 100000, billing_type: 'PIX', metadata: { account_id: ASAAS2 } })
    expect(await evento('evt_m6', 'PAYMENT_REFUNDED')).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'pay_1-refund')).toEqual([expect.objectContaining({ account_id: ASAAS2 })])
  })

  it('#4 com a conta da cobrança: nocional AR:r1 no Itaú (conta da AR) é "outra conta" → cria pay_1 no Asaas e avisa; no Asaas → SWAP', async () => {
    Object.assign(banco.tabelas.accountReceivable[0], { status: 'RECEBIDO', received_amount: 100000 })
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'PENDING', amount: 100000, billing_type: 'PIX', metadata: { account_id: ACC } })
    banco.transacao({ id: 'noc', account_id: ITAU, transaction_type: 'CREDIT', amount: 100000, bank_ref: 'AR:r1' })
    expect(await evento('evt_m7', 'PAYMENT_RECEIVED')).toBe(200)
    expect(banco.tx_('noc')).toBeDefined()
    expect(comRef('pay_1')).toEqual([expect.objectContaining({ account_id: ACC })])
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('ITAU PRINCIPAL') }), expect.anything(), 'warning')
  })

  it('#4 com a conta da cobrança: nocional AR:r1 na conta Asaas (a da cobrança) → SWAP, mesmo com a AR no Itaú', async () => {
    Object.assign(banco.tabelas.accountReceivable[0], { status: 'RECEBIDO', received_amount: 100000 })
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'PENDING', amount: 100000, billing_type: 'PIX', metadata: { account_id: ACC } })
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 100000, bank_ref: 'AR:r1' })
    banco.tabelas.account.find((a) => a.id === ACC)!.current_balance = 197000
    expect(await evento('evt_m8', 'PAYMENT_RECEIVED')).toBe(200)
    expect(banco.tx_('noc')).toBeUndefined()
    expect(comRef('pay_1')).toEqual([expect.objectContaining({ account_id: ACC, amount: 97000 })])
    expect(banco.saldo(ACC)).toBe(194000)
    expect(logError).not.toHaveBeenCalled()
  })
})

describe('F6-A (#1, #7): RECEIVED com a linha ASAAS:PAY:<pay> livre já lançada (livro antes do webhook, linha antiga sem linked_ref)', () => {
  it('liga a linha (linked_ref pay_1, categoria receita), sem nocional nem saldo; AR LIQUIDADO', async () => {
    Object.assign(banco.tabelas.accountReceivable[0], { status: 'PENDENTE', received_amount: 0 })
    banco.categoriasPadrao()
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'PENDING', amount: 100000, billing_type: 'PIX' })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'CREDIT', amount: 97000, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_1', source_text: 'Cobrança recebida', category_id: 'cat:Receita a identificar' })
    expect(await evento('evt_l1', 'PAYMENT_RECEIVED')).toBe(200)
    expect(banco.tx_('L')).toEqual(expect.objectContaining({ linked_ref: 'pay_1', category_id: 'cat:Venda de Servicos', reconciled: true }))
    expect(comRef('pay_1')).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(97000)
    expect(banco.tabelas.accountReceivable[0].status).toBe('LIQUIDADO')
  })

  it('linha livre + nocional AR:r1 do Receber manual na mesma conta → SWAP do nocional e liga a linha (saldo = banco)', async () => {
    Object.assign(banco.tabelas.accountReceivable[0], { status: 'RECEBIDO', received_amount: 100000 })
    banco.pagamento({ id: 'p1', external_id: 'pay_1', receivable_id: 'r1', status: 'PENDING', amount: 100000, billing_type: 'PIX' })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'CREDIT', amount: 97000, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_1', source_text: 'Cobrança recebida' })
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 100000, bank_ref: 'AR:r1' })
    banco.tabelas.account.find((a) => a.id === ACC)!.current_balance = 197000
    expect(await evento('evt_l2', 'PAYMENT_RECEIVED')).toBe(200)
    expect(banco.tx_('noc')).toBeUndefined()
    expect(banco.tx_('L')!.linked_ref).toBe('pay_1')
    expect(comRef('pay_1')).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(97000)
  })
})
