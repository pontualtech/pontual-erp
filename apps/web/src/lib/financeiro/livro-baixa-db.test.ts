import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))

import { conflitoDeBanco, contaAsaasDaEmpresa, desligarLinhas, dinheiroDaAR, SELECT_LINHA_LIGADA } from './livro-baixa-db'
import { banco } from '@/test-utils/banco-falso'

beforeEach(() => {
  banco.reset()
  banco.categoriasPadrao()
})

describe('desligarLinhas (F2-B, #1)', () => {
  it('só desliga a linha ligada pela ref própria (AR:<id>/AP:<id>); a de ref externa fica como está', async () => {
    const refs = ['AR:r1', 'AP:p1', 'pay_x', 'acquirer:rede:1', 'cnab:9', 'AR:r1:anticipation']
    for (const [i, ref] of refs.entries()) {
      banco.transacao({ id: `L${i}`, account_id: 'acc1', transaction_type: i === 1 ? 'DEBIT' : 'CREDIT', amount: 100, origin: 'BANCO', bank_ref: `K${i}`, source_text: `T${i}`, linked_ref: ref, category_id: 'cat:Venda de Servicos' })
    }
    const linhas = await banco.tx.transaction.findMany({ where: { origin: 'BANCO' }, select: SELECT_LINHA_LIGADA })
    await desligarLinhas(banco.tx, 'c1', linhas)
    expect(refs.map((_, i) => banco.tx_(`L${i}`)!.linked_ref)).toEqual([null, null, 'pay_x', 'acquirer:rede:1', 'cnab:9', 'AR:r1:anticipation'])
    expect(banco.tx_('L0')).toEqual(expect.objectContaining({ category_id: 'cat:Receita a identificar', description: 'T0' }))
    expect(banco.tx_('L2')!.category_id).toBe('cat:Venda de Servicos')
  })
})

describe('dinheiroDaAR — reversões do Asaas (F3-B; fix 4, F4-C, #2, #9)', () => {
  const ASAAS = 'asaas1'
  const AR = { id: 'r1', pix_code: null }
  const total = async () => (await dinheiroDaAR(banco.tx, 'c1', AR)).total
  beforeEach(() => { banco.ar({ id: 'r1', total_amount: 50000 }) })

  it('#9 reembolso PARCIAL: CREDIT pay_x 48500 − pay_x-refund 20000 → 28500 (o pagamento continua vivo)', async () => {
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 48500, bank_ref: 'pay_x' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 20000, bank_ref: 'pay_x-refund' })
    expect(await total()).toBe(28500)
  })

  it('#9 duas refs: pay_a revertido por inteiro e pay_b vivo → só pay_b conta (cada reversão anula só o seu pagamento)', async () => {
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_a', status: 'REFUNDED' })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_b', status: 'RECEIVED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 4850, bank_ref: 'pay_a' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'pay_a-refund' })
    banco.transacao({ id: 'b', account_id: ASAAS, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'pay_b' })
    const d = await dinheiroDaAR(banco.tx, 'c1', AR)
    expect(d.total).toBe(9700)
    expect(d.nocionais.map((t) => t.id)).toEqual(['b'])
  })

  it('#2: dinheiro do pagamento ligado como AR:<id> (sem linha/crédito pay_x) + pay_x-refund → a reversão desconta do AR:<id>', async () => {
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'REFUNDED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 9901, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_x', linked_ref: 'AR:r1' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'pay_x-refund' })
    expect(await total()).toBe(0)
  })

  it('F4-C/F6-C: a reversão sai só da linha do PRÓPRIO pagamento (ASAAS:PAY:pay_x ligada como AR:r1); o AR:r1 do Caixa continua contando', async () => {
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'REFUNDED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 9901, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_x', linked_ref: 'AR:r1' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'pay_x-refund' })
    banco.transacao({ account_id: 'caixa', transaction_type: 'CREDIT', amount: 10000, bank_ref: 'AR:r1' })
    expect(await total()).toBe(10000)
  })

  it('F6-C #5: reembolso de um pagamento sem dinheiro no ERP (cartão só CONFIRMED) não come o AR:r1 do Caixa', async () => {
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_c', status: 'REFUNDED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'pay_c-refund' })
    banco.transacao({ account_id: 'caixa', transaction_type: 'CREDIT', amount: 10000, bank_ref: 'AR:r1' })
    expect(await total()).toBe(10000)
  })

  it('F6-C: reembolso sem dinheiro do pagamento não come a linha PIX do Itaú ligada como AR:r1 (outra origem)', async () => {
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_c', status: 'REFUNDED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'pay_c-refund' })
    banco.transacao({ account_id: 'itau', transaction_type: 'CREDIT', amount: 10000, origin: 'BANCO', bank_ref: 'ITAU:k', linked_ref: 'AR:r1' })
    expect(await total()).toBe(10000)
  })

  it('F6-C m9: dinheiro do pagamento numa linha ASAAS:PAY LIVRE (não ligada) → a reversão não come o AR:r1 do Caixa', async () => {
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'REFUNDED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 9901, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_x' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'pay_x-refund' })
    banco.transacao({ account_id: 'caixa', transaction_type: 'CREDIT', amount: 10000, bank_ref: 'AR:r1' })
    expect(await total()).toBe(10000)
  })

  it('F4-C: reversão maior que o AR:<id> não come o dinheiro de outro pagamento (pay_b)', async () => {
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'REFUNDED' })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_b', status: 'RECEIVED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 5000, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_x', linked_ref: 'AR:r1' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'pay_x-refund' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'pay_b' })
    expect(await total()).toBe(9700)
  })

  it('F4-C: com crédito/linha viva da própria ref pay_x, a reversão desconta dela (não do AR:<id>)', async () => {
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'REFUNDED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 9901, bank_ref: 'pay_x' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'pay_x-refund' })
    banco.transacao({ account_id: 'caixa', transaction_type: 'CREDIT', amount: 10000, bank_ref: 'AR:r1' })
    expect(await total()).toBe(10000)
  })
})

describe('conflitoDeBanco (F2-D; fix 4, F4-D, m3): os formatos em que o Prisma 5 entrega deadlock/serialização/timeout', () => {
  it('P2034, P2028, P2010 com 40P01 (raw query) e erro sem code com PostgresError 40P01/40001 → conflito', () => {
    expect(conflitoDeBanco(Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), { code: 'P2034' }))).toBe(true)
    expect(conflitoDeBanco(Object.assign(new Error('Transaction API error: Unable to start a transaction in the given time.'), { code: 'P2028' }))).toBe(true)
    expect(conflitoDeBanco(Object.assign(new Error('Raw query failed. Code: `40P01`. Message: `deadlock detected`'), { code: 'P2010', meta: { code: '40P01', message: 'deadlock detected' } }))).toBe(true)
    expect(conflitoDeBanco(new Error('Error occurred during query execution: ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "40P01", message: "deadlock detected", severity: "ERROR" }) })'))).toBe(true)
    expect(conflitoDeBanco(new Error('ConnectorError(... PostgresError { code: "40001", message: "could not serialize access due to concurrent update" ...)'))).toBe(true)
    expect(conflitoDeBanco(Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { code: '40001' } }))).toBe(true)
  })

  it('outros erros não são conflito (P2002, P2010 de sintaxe, erro comum, null)', () => {
    expect(conflitoDeBanco(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))).toBe(false)
    expect(conflitoDeBanco(Object.assign(new Error('Raw query failed. Code: `42601`. Message: `syntax error`'), { code: 'P2010', meta: { code: '42601' } }))).toBe(false)
    expect(conflitoDeBanco(new Error('boom'))).toBe(false)
    expect(conflitoDeBanco(null)).toBe(false)
  })
})

describe('contaAsaasDaEmpresa (F6-D, #4, #9, #12): pelo provedor, não pelo nome', () => {
  it("1º a conta ativa com provider_config.provider = 'asaas' — a 'ASSAS' de produção, mesmo com outra chamada 'Asaas'", async () => {
    banco.conta({ id: 'velha', name: 'Asaas antiga', current_balance: 0 })
    banco.conta({ id: 'assas', name: 'ASSAS', provider_config: { provider: 'ASAAS', api_key: 'x' }, current_balance: 0 })
    expect(await contaAsaasDaEmpresa(banco.tx, 'c1')).toBe('assas')
  })

  it("2º pelo nome/banco contendo 'asaas' OU 'assas'", async () => {
    banco.conta({ id: 'itau', name: 'ITAU PRINCIPAL', current_balance: 0 })
    banco.conta({ id: 'assas', name: 'ASSAS', current_balance: 0 })
    expect(await contaAsaasDaEmpresa(banco.tx, 'c1')).toBe('assas')
    banco.reset()
    banco.conta({ id: 'b', name: 'Cobranças', bank_name: 'Asaas Gestão', current_balance: 0 })
    expect(await contaAsaasDaEmpresa(banco.tx, 'c1')).toBe('b')
  })

  it('inativa ou de outra empresa não vale; sem nenhuma → null', async () => {
    banco.conta({ id: 'off', name: 'ASSAS', provider_config: { provider: 'asaas' }, is_active: false, current_balance: 0 })
    banco.inserir('account', { id: 'alheia', company_id: 'c2', name: 'ASSAS', is_active: true, provider_config: { provider: 'asaas' } })
    banco.conta({ id: 'itau', name: 'ITAU PRINCIPAL', current_balance: 0 })
    expect(await contaAsaasDaEmpresa(banco.tx, 'c1')).toBeNull()
  })
})

describe('desligarLinhas — F7-C: a linha lembra a conta que pagava', () => {
  it('grava desligada_de = linked_ref ao desligar', async () => {
    banco.transacao({ id: 'L', account_id: 'acc1', transaction_type: 'CREDIT', amount: 100, origin: 'BANCO', bank_ref: 'K', source_text: 'PIX', linked_ref: 'AR:a1', category_id: 'cat:Venda de Servicos' })
    const linhas = await banco.tx.transaction.findMany({ where: { id: 'L' }, select: SELECT_LINHA_LIGADA })
    await desligarLinhas(banco.tx, 'c1', linhas)
    expect(banco.tx_('L')).toEqual(expect.objectContaining({ linked_ref: null, desligada_de: 'AR:a1' }))
  })
})
