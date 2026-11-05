import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/observability', () => ({ logError: vi.fn(async () => undefined) }))

import { performMatch } from './perform-match'
import { banco } from '@/test-utils/banco-falso'
import { logError } from '@/lib/observability'

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

// 05/11 (OS 63022): o repasse da Rede entrou no livro ANTES do vínculo (linha do banco livre, líquido da venda) — o
// vínculo tem de ligar a essa linha; criar o acquirer: por cima contava o mesmo dinheiro 2x no Itaú.
describe('repasse já no livro como linha do banco livre (entrou antes do vínculo)', () => {
  const vincularEm = (dia: string) => performMatch({ transactionId: 't1', serviceOrderId: 'os1', companyId: 'c1', matchMethod: 'MANUAL', creditDate: new Date(`${dia}T12:00:00-03:00`) })

  it('linha BANCO livre do líquido na conta da adquirente, perto da data do crédito → liga a ela, sem 2º crédito nem saldo', async () => {
    banco.transacao({ id: 'linha', account_id: 'itau', transaction_type: 'CREDIT', amount: 97000, origin: 'BANCO', bank_ref: 'ITAU:k2', linked_ref: null, source_text: 'RECEBIMENTO REDE VISA', transaction_date: new Date('2026-11-02T00:00:00Z') })
    banco.tabelas.account[0].current_balance = 97000
    expect((await vincularEm('2026-11-02')).ok).toBe(true)
    expect(doNSU()).toEqual([expect.objectContaining({ id: 'linha', origin: 'BANCO', linked_ref: REF })])
    expect(doNSU()[0].description).toMatch(/Maquininha rede — OS-63001 — credito 1x · banco: RECEBIMENTO REDE VISA/)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === REF)).toHaveLength(0)
    expect(banco.saldo('itau')).toBe(97000)
  })

  it('linha do banco de outro valor ou já ligada a outra coisa não é tomada → cria o acquirer: como antes', async () => {
    banco.transacao({ account_id: 'itau', transaction_type: 'CREDIT', amount: 96999, origin: 'BANCO', bank_ref: 'ITAU:k3', linked_ref: null, transaction_date: new Date('2026-11-02T00:00:00Z') })
    banco.transacao({ account_id: 'itau', transaction_type: 'CREDIT', amount: 97000, origin: 'BANCO', bank_ref: 'ITAU:k4', linked_ref: 'AR:outra', transaction_date: new Date('2026-11-02T00:00:00Z') })
    expect((await vincularEm('2026-11-02')).ok).toBe(true)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === REF)).toEqual([expect.objectContaining({ amount: 97000, origin: null })])
    expect(banco.saldo('itau')).toBe(97000)
  })

  it('linha BANCO livre do mesmo valor mas fora da janela (20 dias antes) → não liga; cria o acquirer:', async () => {
    banco.transacao({ account_id: 'itau', transaction_type: 'CREDIT', amount: 97000, origin: 'BANCO', bank_ref: 'ITAU:k5', linked_ref: null, transaction_date: new Date('2026-10-13T00:00:00Z') })
    expect((await vincularEm('2026-11-02')).ok).toBe(true)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === REF)).toHaveLength(1)
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

describe('F6-E (#6, m2, m3): vínculo da maquininha com as guardas do webhook', () => {
  const CAIXA = 'caixa'
  beforeEach(() => { vi.mocked(logError).mockClear() })

  it('#6: AR já quitada por Receber manual com nocional AR:a1 na conta da adquirente → SWAP: apaga o AR:a1 (e o saldo) e cria o acquirer: líquido', async () => {
    banco.ar({ id: 'a1', service_order_id: 'os1', status: 'RECEBIDO', total_amount: 100000, received_amount: 100000, account_id: 'itau' })
    banco.transacao({ id: 'noc', account_id: 'itau', transaction_type: 'CREDIT', amount: 100000, bank_ref: 'AR:a1' })
    banco.tabelas.account[0].current_balance = 100000
    expect((await vincular()).ok).toBe(true)
    expect(banco.tx_('noc')).toBeUndefined()
    expect(doNSU()).toEqual([expect.objectContaining({ bank_ref: REF, amount: 97000 })])
    expect(banco.saldo('itau')).toBe(97000)
    expect(logError).not.toHaveBeenCalled()
  })

  it('nocional AR:a1 noutra conta (Caixa) → cria o acquirer: e registra a possível duplicidade (depois do commit)', async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 100000 })
    banco.ar({ id: 'a1', service_order_id: 'os1', status: 'RECEBIDO', total_amount: 100000, received_amount: 100000, account_id: CAIXA })
    banco.transacao({ id: 'noc', account_id: CAIXA, transaction_type: 'CREDIT', amount: 100000, bank_ref: 'AR:a1' })
    expect((await vincular()).ok).toBe(true)
    expect(banco.tx_('noc')).toBeDefined()
    expect(doNSU()).toHaveLength(1)
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('possível duplicidade: AR recebida manualmente em Caixa e também pela rede (NSU NSU1)') }),
      expect.objectContaining({ company_id: 'c1' }),
      'warning',
    )
  })

  it('linha do banco ligada a AR:a1 na conta da adquirente → não cria o acquirer: (o dinheiro já está)', async () => {
    banco.ar({ id: 'a1', service_order_id: 'os1', status: 'LIQUIDADO', total_amount: 100000, received_amount: 100000, account_id: 'itau' })
    banco.transacao({ account_id: 'itau', transaction_type: 'CREDIT', amount: 100000, origin: 'BANCO', bank_ref: 'ITAU:k', linked_ref: 'AR:a1' })
    banco.tabelas.account[0].current_balance = 100000
    expect((await vincular()).ok).toBe(true)
    expect(doNSU()).toEqual([])
    expect(banco.saldo('itau')).toBe(100000)
  })

  it('OS paga em 2 formas (62473): a linha do Pix ligada à AR não cobre a venda → troca o nocional do cartão e liga ao repasse', async () => {
    banco.ar({ id: 'a1', service_order_id: 'os1', status: 'RECEBIDO', total_amount: 130000, received_amount: 130000, account_id: 'itau' })
    banco.transacao({ id: 'pix', account_id: 'itau', transaction_type: 'CREDIT', amount: 30000, origin: 'BANCO', bank_ref: 'ITAU:pix', linked_ref: 'AR:a1', transaction_date: new Date('2026-11-01T00:00:00Z') })
    banco.transacao({ id: 'noc', account_id: 'itau', transaction_type: 'CREDIT', amount: 100000, bank_ref: 'AR:a1' })
    banco.transacao({ id: 'repasse', account_id: 'itau', transaction_type: 'CREDIT', amount: 97000, origin: 'BANCO', bank_ref: 'ITAU:rep', linked_ref: null, source_text: 'RECEBIMENTO REDE MAST', transaction_date: new Date('2026-11-02T00:00:00Z') })
    banco.tabelas.account[0].current_balance = 227000
    expect((await performMatch({ transactionId: 't1', serviceOrderId: 'os1', companyId: 'c1', matchMethod: 'MANUAL', creditDate: new Date('2026-11-02T12:00:00-03:00') })).ok).toBe(true)
    expect(banco.tx_('noc')).toBeUndefined()
    expect(banco.tx_('pix')).toEqual(expect.objectContaining({ linked_ref: 'AR:a1', amount: 30000 }))
    expect(doNSU()).toEqual([expect.objectContaining({ id: 'repasse', origin: 'BANCO', linked_ref: REF })])
    expect(banco.saldo('itau')).toBe(127000)
    expect(logError).not.toHaveBeenCalled()
  })

  it('OS com 2 contas (62959, cartão + Pix): a venda vai para a conta do valor dela, não para a primeira', async () => {
    banco.ar({ id: 'pix', service_order_id: 'os1', status: 'RECEBIDO', total_amount: 20000, received_amount: 20000, account_id: 'itau' })
    banco.ar({ id: 'cartao', service_order_id: 'os1', status: 'RECEBIDO', total_amount: 100000, received_amount: 100000, account_id: 'itau' })
    const r = await performMatch({ transactionId: 't1', serviceOrderId: 'os1', companyId: 'c1', matchMethod: 'MANUAL', creditDate: new Date('2026-11-02T12:00:00-03:00') })
    expect(r.receivable_id).toBe('cartao')
  })

  it('m2: AR excluída enquanto esperava a trava → nada escrito (nem Payment, nem crédito), erro', async () => {
    banco.ar({ id: 'a1', service_order_id: 'os1', status: 'PENDENTE', total_amount: 100000, received_amount: 0, account_id: 'itau' })
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts_receivable') return
      banco.tabelas.accountReceivable[0].deleted_at = new Date()
      banco.aoTravar(null)
    })
    const r = await vincular()
    expect(r.ok).toBe(false)
    expect(banco.tabelas.payment ?? []).toEqual([])
    expect(doNSU()).toEqual([])
    expect(banco.tabelas.accountReceivable[0].status).toBe('PENDENTE')
  })

  it('m3: taxa estimada paga enquanto esperava a trava → não é cancelada e a taxa real não entra', async () => {
    banco.ar({ id: 'a1', service_order_id: 'os1', status: 'PENDENTE', total_amount: 100000, received_amount: 0, account_id: 'itau' })
    banco.ap({ id: 'est', description: 'Taxa cartão OS-63001 — estimada', status: 'PENDENTE', total_amount: 3000 })
    banco.tabelas.acquirerTransaction[0].mdr_fee_amount = 3000
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts_payable') return
      Object.assign(banco.tabelas.accountPayable.find((a) => a.id === 'est')!, { status: 'PAGO', paid_amount: 3000 })
      banco.aoTravar(null)
    })
    expect((await vincular()).ok).toBe(true)
    expect(banco.tabelas.accountPayable.find((a) => a.id === 'est')!.status).toBe('PAGO')
    expect(banco.tabelas.accountPayable.filter((a) => (a.description as string).startsWith('MDR'))).toEqual([])
  })
})

describe('F7-A (#1): vínculo da maquininha só troca nocional posterior ao ajuste', () => {
  it('nocional AR:a1 anterior ao ajuste da conta da adquirente → fica; o acquirer: é criado', async () => {
    banco.ar({ id: 'a1', service_order_id: 'os1', status: 'RECEBIDO', total_amount: 100000, received_amount: 100000, account_id: 'itau' })
    banco.transacao({ id: 'noc', account_id: 'itau', transaction_type: 'CREDIT', amount: 100000, bank_ref: 'AR:a1', created_at: new Date('2026-10-28T15:00:00Z') })
    banco.transacao({ id: 'aj', account_id: 'itau', transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: 'AJUSTE:itau:2026-10-29', created_at: new Date('2026-10-30T10:00:00Z') })
    expect((await vincular()).ok).toBe(true)
    expect(banco.tx_('noc')).toBeDefined()
    expect(doNSU()).toEqual([expect.objectContaining({ amount: 97000 })])
    expect(banco.saldo('itau')).toBe(97000)
  })
})

describe('F7-G (m12, m13): guardas do perform-match que faltavam testar', () => {
  it('m12: crédito AR:a1 com marcador LIGADA na conta da adquirente não é trocado', async () => {
    banco.ar({ id: 'a1', service_order_id: 'os1', status: 'RECEBIDO', total_amount: 100000, received_amount: 100000, account_id: 'itau' })
    banco.transacao({ id: 'lig', account_id: 'itau', transaction_type: 'CREDIT', amount: 100000, bank_ref: 'AR:a1', source_text: 'LIGADA:ITAU:k' })
    expect((await vincular()).ok).toBe(true)
    expect(banco.tx_('lig')).toBeDefined()
  })

  it('m13: AR CANCELADA enquanto esperava a trava → nada escrito, erro', async () => {
    banco.ar({ id: 'a1', service_order_id: 'os1', status: 'PENDENTE', total_amount: 100000, received_amount: 0, account_id: 'itau' })
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts_receivable') return
      banco.tabelas.accountReceivable[0].status = 'CANCELADO'
      banco.aoTravar(null)
    })
    const r = await vincular()
    expect(r.ok).toBe(false)
    expect(banco.tabelas.payment ?? []).toEqual([])
    expect(doNSU()).toEqual([])
  })
})
