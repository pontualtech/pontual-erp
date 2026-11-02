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
