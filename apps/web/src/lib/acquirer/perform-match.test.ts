import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))

import { performMatch } from './perform-match'
import { banco } from '@/test-utils/banco-falso'

const REF = 'acquirer:rede:NSU1'
const vincular = () => performMatch({ transactionId: 't1', serviceOrderId: 'os1', companyId: 'c1', matchMethod: 'MANUAL' })
const doNSU = () => banco.tabelas.transaction.filter((t) => t.bank_ref === REF || t.linked_ref === REF)

beforeEach(() => {
  banco.reset()
  banco.categoriasPadrao()
  banco.conta({ id: 'itau', name: 'Itaú', current_balance: 0 })
  banco.inserir('setting', { company_id: 'c1', key: 'acquirer.rede.account_id', value: 'itau' })
  banco.inserir('serviceOrder', { id: 'os1', company_id: 'c1', os_number: 63001, customer_id: 'cli1', deleted_at: null, internal_notes: null })
  banco.inserir('acquirerTransaction', {
    id: 't1', company_id: 'c1', status: 'APPROVED', matched_payment_id: null, acquirer: 'rede', external_id: 'NSU1',
    gross_amount: 100000, net_amount: 97000, total_fee_amount: 3000, mdr_fee_amount: 0, anticipation_fee_amount: 0,
    mdr_fee_percent: 0, anticipation_fee_percent: 0, modality: 'credit', installments: 1, card_brand: 'visa', card_last_4: '1234',
    terminal_code: 'T1', transaction_date: new Date('2026-11-01T12:00:00Z'), expected_credit_date: new Date('2026-11-02T00:00:00Z'),
  })
})

describe('vínculo da maquininha — "já lançado" vale também para o crédito convertido pelo livro (onda 4, fix 1)', () => {
  it('controle: cria o CREDIT acquirer:rede:<NSU> pelo líquido e soma no saldo', async () => {
    expect((await vincular()).ok).toBe(true)
    expect(doNSU()).toEqual([expect.objectContaining({ bank_ref: REF, transaction_type: 'CREDIT', amount: 97000 })])
    expect(banco.saldo('itau')).toBe(97000)
  })

  it('o crédito desta venda já virou linha BANCO (linked_ref acquirer:rede:NSU1): vincula sem criar 2º crédito', async () => {
    banco.transacao({ account_id: 'itau', transaction_type: 'CREDIT', amount: 97000, origin: 'BANCO', bank_ref: 'ITAU:k', linked_ref: REF })
    banco.tabelas.account[0].current_balance = 97000
    expect((await vincular()).ok).toBe(true)
    expect(doNSU()).toHaveLength(1)
    expect(banco.saldo('itau')).toBe(97000)
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

describe('F2-D (#4): vínculo da maquininha trava a conta antes da AR', () => {
  it('accounts (Itaú) antes de criar/atualizar a AR e do ondeRef', async () => {
    await vincular()
    expect(banco.travas[0]).toEqual(expect.objectContaining({ tabela: 'accounts', id: 'itau' }))
    ordemTravas('accountReceivable')
  })
})

describe('F3-D (#4): vínculo da maquininha — opções da tx e conflito', () => {
  it('$transaction com maxWait 10s e timeout 20s; P2034 → { ok: false, error: "conflito com outra operação — repita" }', async () => {
    await vincular()
    expect(banco.transacoes.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }])
    banco.reset(); banco.categoriasPadrao(); banco.conta({ id: 'itau' })
    banco.inserir('setting', { company_id: 'c1', key: 'acquirer.rede.account_id', value: 'itau' })
    banco.inserir('serviceOrder', { id: 'os1', company_id: 'c1', os_number: 63001, customer_id: 'cli1', deleted_at: null })
    banco.inserir('acquirerTransaction', { id: 't1', company_id: 'c1', status: 'APPROVED', matched_payment_id: null, acquirer: 'rede', external_id: 'NSU1', gross_amount: 100, net_amount: 97, total_fee_amount: 3, mdr_fee_amount: 0, anticipation_fee_amount: 0, modality: 'credit', installments: 1, transaction_date: new Date() })
    banco.tx.payment.create.mockImplementationOnce(async () => { throw Object.assign(new Error('deadlock detected'), { code: 'P2034' }) })
    expect(await vincular()).toEqual({ ok: false, error: 'conflito com outra operação — repita' })
  })
})

describe('F4-D (#6): vínculo da maquininha trava a AR e decide pela releitura', () => {
  it('Receber parcial de 3000 comitado durante a espera → received_amount 10000 e RECEBIDO (não 7000 PARCIAL)', async () => {
    banco.ar({ id: 'a1', service_order_id: 'os1', status: 'PENDENTE', total_amount: 10000, received_amount: 0, account_id: 'itau' })
    banco.tabelas.acquirerTransaction[0].gross_amount = 7000
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts_receivable') return
      Object.assign(banco.tabelas.accountReceivable[0], { received_amount: 3000 })
      banco.aoTravar(null)
    })
    expect((await vincular()).ok).toBe(true)
    expect(banco.tabelas.accountReceivable[0]).toEqual(expect.objectContaining({ received_amount: 10000, status: 'RECEBIDO' }))
    expect(banco.travas.map((t) => t.tabela)).toEqual(['accounts', 'accounts_receivable'])
  })
})
