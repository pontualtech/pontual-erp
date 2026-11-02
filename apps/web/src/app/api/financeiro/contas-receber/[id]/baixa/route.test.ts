import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'

const ACC = '11111111-1111-4111-8111-111111111111'
const AR = { id: 'r1', status: 'PENDENTE', reconciled: false, total_amount: 15000, received_amount: 0, description: 'OS 1', category_id: null }
const receber = async (body: Record<string, unknown> = {}) => {
  const res = await POST(new NextRequest('http://x/api', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ received_amount: 15000, account_id: ACC, received_at: '2026-10-29', ...body }),
  }), { params: { id: 'r1' } })
  return { status: res.status, j: await res.json() }
}
// Linha do livro (BANCO) de entrada, livre, em "Receita a identificar", de 28/10.
const linha = (over: Record<string, unknown> = {}) => banco.transacao({
  id: 't1', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, origin: 'BANCO', bank_ref: 'ITAU:k1', source_text: 'PIX RECEBIDO FULANO',
  description: 'PIX RECEBIDO FULANO', category_id: 'cat:Receita a identificar', transaction_date: new Date('2026-10-28T00:00:00Z'), ...over,
})
const ar = () => banco.tabelas.accountReceivable.find((a) => a.id === 'r1')!
const creditosAR = () => banco.tabelas.transaction.filter((t) => t.bank_ref === 'AR:r1')

beforeEach(() => {
  banco.reset()
  banco.categoriasPadrao()
  banco.conta({ id: ACC, current_balance: 100000 })
})

describe('Receber (baixa de AR) — livro-razão', () => {
  it('liga ao lançamento do banco em fallback: sem crédito novo e sem saldo; a linha recebe a categoria de receita', async () => {
    banco.ar(AR)
    linha()
    const { status, j } = await receber()
    expect(status).toBe(200)
    expect(j.data).toEqual(expect.objectContaining({ id: 'r1', status: 'RECEBIDO', ligada: true }))
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({
      linked_ref: 'AR:r1', category_id: 'cat:Venda de Servicos', description: 'Recebimento: OS 1 · banco: PIX RECEBIDO FULANO', reconciled: true,
    }))
    expect(creditosAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('linha já categorizada (Venda de Servicos): liga e mantém a categoria; categoria alheia (Rendimentos) nunca', async () => {
    banco.ar(AR)
    linha({ category_id: 'cat:Venda de Servicos' })
    linha({ id: 't2', bank_ref: 'ITAU:k2', category_id: 'cat:Rendimentos', transaction_date: new Date('2026-10-29T00:00:00Z') })
    expect((await receber()).j.data.ligada).toBe(true)
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: 'AR:r1', category_id: 'cat:Venda de Servicos' }))
    expect(banco.tx_('t2')!.linked_ref).toBeNull()
  })

  it('sem candidato: cria o crédito AR:id e soma no saldo como hoje', async () => {
    banco.ar(AR)
    const { j } = await receber()
    expect(j.data.ligada).toBe(false)
    expect(creditosAR()).toEqual([expect.objectContaining({ transaction_type: 'CREDIT', amount: 15000, account_id: ACC, reconciled: true })])
    expect(banco.saldo(ACC)).toBe(115000)
  })

  it('E3: janela = 10 dias antes / 3 depois da data real; linha de 20 dias antes não é ligada (cria)', async () => {
    banco.ar(AR)
    linha({ transaction_date: new Date('2026-10-09T00:00:00Z') })
    expect((await receber()).j.data.ligada).toBe(false)
    expect(creditosAR()).toHaveLength(1)
  })

  it('linha ligada por outra baixa no meio (guard count 0): 409 e a AR NÃO fica recebida (rollback)', async () => {
    banco.ar(AR)
    linha()
    banco.tx.transaction.updateMany.mockImplementationOnce(async () => ({ count: 0 }))
    expect((await receber()).status).toBe(409)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0 }))
    expect(creditosAR()).toEqual([])
  })
})

describe('§7: trava conta → AR e decide pela releitura (G1, E7, #9)', () => {
  it('trava accounts ANTES da AR, e lê candidatos/escreve só depois das duas travas, pelo tx', async () => {
    banco.ar(AR)
    linha()
    await receber()
    expect(banco.travas.map((t) => [t.tabela, t.id])).toEqual([['accounts', ACC], ['accounts_receivable', 'r1']])
    const depois = banco.travas[1].seq
    const leituras = banco.log.filter((o) => o.modelo === 'transaction' && o.op === 'findMany')
    // Fora da tx, só a leitura de QUAIS contas travar (F8-C: as das linhas desligadas desta AR); o resto pelo tx, depois.
    expect(leituras.filter((o) => o.cliente !== 'tx')).toHaveLength(1)
    expect(leituras.filter((o) => o.cliente === 'tx').length).toBeGreaterThan(0)
    expect(leituras.filter((o) => o.cliente === 'tx').every((o) => o.seq > depois)).toBe(true)
    expect(banco.prismaDentroDaTx()).toEqual([])
  })

  it('#9: linha do banco comitada pelo livro enquanto esperava a trava da conta → a baixa a vê e LIGA (não cria 2x)', async () => {
    banco.ar(AR)
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts') return
      linha()
      banco.tabelas.account[0].current_balance += 15000
      banco.aoTravar(null)
    })
    const { j } = await receber()
    expect(j.data.ligada).toBe(true)
    expect(creditosAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(115000) // o PIX conta uma vez
  })

  it('G1: duplo clique — a 1ª baixa parcial comitou enquanto esta esperava: 409, nada criado nem creditado', async () => {
    banco.ar(AR)
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts_receivable') return
      Object.assign(ar(), { received_amount: 5000 })
      banco.aoTravar(null)
    })
    const { status, j } = await receber({ received_amount: 5000 })
    expect(status).toBe(409)
    expect(j.error).toMatch(/Baixa concorrente detectada/)
    expect(creditosAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('E7: recebida por outra baixa enquanto esperava → 409; parcial concorrente que passa do restante → 422', async () => {
    banco.ar(AR)
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_receivable') Object.assign(ar(), { status: 'RECEBIDO', received_amount: 15000 }) })
    expect((await receber()).status).toBe(409)
    Object.assign(ar(), { status: 'PENDENTE', received_amount: 0 })
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_receivable') Object.assign(ar(), { received_amount: 5000 }) })
    const r = await receber()
    expect(r.status).toBe(422)
    expect(r.j.error).toMatch(/excede o saldo restante/)
    expect(creditosAR()).toEqual([])
  })

  it('§8: conta excluída durante a baixa → 409 com mensagem sem jargão', async () => {
    banco.ar(AR)
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_receivable') ar().deleted_at = new Date() })
    const { status, j } = await receber()
    expect(status).toBe(409)
    expect(j.error).toBe('conta não encontrada durante a baixa')
  })

  it('§8: received_at que não é data → 422 (antes: 500)', async () => {
    banco.ar(AR)
    const { status } = await receber({ received_at: '31/10/2026' })
    expect(status).toBe(422)
    expect(creditosAR()).toEqual([])
  })
})

describe('F2-A (#3): Receber enxerga o dinheiro já lançado da AR', () => {
  const AVISO = 'dinheiro desta conta já está lançado (adquirente/CNAB/Asaas/banco) — nenhum lançamento novo criado'
  it('crédito do CNAB vivo (estorno (d) por engano): Receber não cria nada, não mexe no saldo e avisa; a AR ganha a conta do crédito', async () => {
    banco.conta({ id: 'inter', current_balance: 50000 })
    banco.ar({ ...AR, total_amount: 50000, account_id: null, pix_code: JSON.stringify({ nossoNumero: '123' }) })
    banco.transacao({ account_id: 'inter', transaction_type: 'CREDIT', amount: 50000, bank_ref: 'cnab:123' })
    const { status, j } = await receber({ received_amount: 50000, dinheiro: 'mesmo' })
    expect(status).toBe(200)
    expect(j.data).toEqual(expect.objectContaining({ status: 'RECEBIDO', received_amount: 50000, ligada: false, aviso: AVISO }))
    expect(creditosAR()).toEqual([])
    expect(banco.tx.account.update).not.toHaveBeenCalled()
    expect(ar().account_id).toBe('inter')
  })

  it('linha do banco ligada pela ref do Asaas (linked_ref pay_x): idem', async () => {
    banco.ar({ ...AR, account_id: ACC })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 14600, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_x', linked_ref: 'pay_x' })
    linha() // linha livre de mesmo valor: não é ligada
    const { j } = await receber({ dinheiro: 'mesmo' })
    expect(j.data.aviso).toBe(AVISO)
    expect(banco.tx_('t1')!.linked_ref).toBeNull()
    expect(creditosAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('recebimento parcial já registrado (CREDIT AR:id = received_amount) não bloqueia a 2ª parcela', async () => {
    banco.ar({ ...AR, received_amount: 5000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 5000, bank_ref: 'AR:r1' })
    const { j } = await receber({ received_amount: 10000 })
    expect(j.data).not.toHaveProperty('aviso')
    expect(creditosAR().map((t) => t.amount)).toEqual([5000, 10000])
    expect(banco.saldo(ACC)).toBe(110000)
  })
})

describe('F2-D (m9): conflito do banco (P2034/P2028) vira 409, não 500', () => {
  it('deadlock na tx do Receber → 409 "conflito com outra operação — repita", nada gravado', async () => {
    banco.ar(AR)
    banco.tx.transaction.create.mockImplementationOnce(async () => { throw Object.assign(new Error('deadlock detected'), { code: 'P2034' }) })
    const { status, j } = await receber()
    expect(status).toBe(409)
    expect(j.error).toBe('conflito com outra operação — repita')
    expect(ar().status).toBe('PENDENTE')
  })
})

describe('F2-G (m21): opções da $transaction', () => {
  it('maxWait 10s e timeout 20s', async () => {
    banco.ar(AR)
    await receber()
    expect(banco.transacoes.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }])
  })
})

describe('F3-B (#9, #3): dinheiro externo é líquido de estorno/chargeback do Asaas', () => {
  const ASAAS = 'asaas1'
  beforeEach(() => { banco.conta({ id: ASAAS, name: 'Asaas', current_balance: 0 }) })

  it('#9: CREDIT pay_x 485 + DEBIT pay_x-chargeback 500 → Receber do novo pagamento cria CREDIT AR:<id> na conta pedida', async () => {
    banco.ar({ ...AR, total_amount: 50000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'DISPUTED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 48500, bank_ref: 'pay_x' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 50000, bank_ref: 'pay_x-chargeback' })
    const { j } = await receber({ received_amount: 50000 })
    expect(j.data).not.toHaveProperty('aviso')
    expect(creditosAR()).toEqual([expect.objectContaining({ account_id: ACC, amount: 50000 })])
    expect(banco.saldo(ACC)).toBe(150000)
  })

  it('#3: REFUNDED (DEBIT pay_x-refund, já convertido pelo livro) e novo pagamento em Caixa → CREDIT AR:<id> em Caixa', async () => {
    const CAIXA = '33333333-3333-4333-8333-333333333333'
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 0 })
    banco.ar({ ...AR, total_amount: 50000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'REFUNDED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 49900, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_x', linked_ref: 'pay_x' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 50000, origin: 'BANCO', bank_ref: 'ASAAS:2026-11-01|REFUND|-50000|1', linked_ref: 'pay_x-refund' })
    const { j } = await receber({ received_amount: 50000, account_id: CAIXA })
    expect(j.data).not.toHaveProperty('aviso')
    expect(creditosAR()).toEqual([expect.objectContaining({ account_id: CAIXA, amount: 50000 })])
    expect(banco.saldo(CAIXA)).toBe(50000)
  })

  it('crédito externo sem reversão continua sendo dinheiro já lançado → só a claim, como no F2-A', async () => {
    banco.ar({ ...AR, total_amount: 50000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 48500, bank_ref: 'pay_x' })
    const { j } = await receber({ received_amount: 50000, dinheiro: 'mesmo' })
    expect(j.data.aviso).toBeTruthy()
    expect(creditosAR()).toEqual([])
  })
})

describe('Fix 3 — testes menores do Receber (m6, m8)', () => {
  const AVISO = 'dinheiro desta conta já está lançado (adquirente/CNAB/Asaas/banco) — nenhum lançamento novo criado'
  it('m6: crédito externo (CNAB) comitado enquanto o Receber esperava a trava → só a claim + aviso; nada criado, saldo intocado', async () => {
    banco.ar({ ...AR, account_id: ACC, pix_code: JSON.stringify({ nossoNumero: '123' }) })
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts') return
      banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'cnab:123' })
      banco.tabelas.account[0].current_balance += 15000
      banco.aoTravar(null)
    })
    const { status, j } = await receber({ dinheiro: 'mesmo' })
    expect(status).toBe(200)
    expect(j.data).toEqual(expect.objectContaining({ ligada: false, aviso: AVISO }))
    expect(creditosAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(115000) // o crédito do CNAB conta uma vez
  })

  it('m8 (desvio aceito): com o dinheiro já lançado, Receber não quita a AP da taxa do cartão nem debita', async () => {
    banco.ar({ ...AR, account_id: ACC, card_fee_total: 450, service_order_id: 'os1', pix_code: JSON.stringify({ nossoNumero: '123' }) })
    banco.ap({ id: 'taxa', service_order_id: 'os1', total_amount: 450, status: 'PENDENTE' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'cnab:123' })
    const { j } = await receber({ dinheiro: 'mesmo' })
    expect(j.data.aviso).toBe(AVISO)
    expect(banco.tabelas.accountPayable.find((a) => a.id === 'taxa')).toEqual(expect.objectContaining({ status: 'PENDENTE', paid_amount: 0 }))
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'AP:taxa')).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })
})

describe('F4-C (#2): reembolso do pagamento cujo dinheiro foi ligado como AR:<id>', () => {
  it('linha ASAAS:PAY ligada como AR:r1 + pay_x-refund (AR PENDENTE/0) → Receber em Caixa cria o CREDIT', async () => {
    const ASAAS = 'asaas1'
    const CAIXA = '33333333-3333-4333-8333-333333333333'
    banco.conta({ id: ASAAS, name: 'Asaas', current_balance: 0 })
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 0 })
    banco.ar({ ...AR, total_amount: 10000, account_id: ASAAS })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'REFUNDED' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'CREDIT', amount: 9901, origin: 'BANCO', bank_ref: 'ASAAS:PAY:pay_x', linked_ref: 'AR:r1' })
    banco.transacao({ account_id: ASAAS, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'pay_x-refund' })
    const { status, j } = await receber({ received_amount: 10000, account_id: CAIXA })
    expect(status).toBe(200)
    expect(j.data).not.toHaveProperty('aviso')
    expect(creditosAR().filter((t) => t.account_id === CAIXA)).toEqual([expect.objectContaining({ amount: 10000 })])
    expect(banco.saldo(CAIXA)).toBe(10000)
  })
})

describe('F6-C (#5): reembolso do cartão que nunca entrou não abre espaço para um 2º crédito', () => {
  it('Receber no Caixa depois do REFUNDED de um cartão só CONFIRMED, com o dinheiro do Caixa já lançado → só a claim + aviso', async () => {
    const CAIXA = '33333333-3333-4333-8333-333333333333'
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 10000 })
    banco.ar({ ...AR, total_amount: 10000, account_id: CAIXA })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_c', status: 'REFUNDED' })
    banco.transacao({ account_id: CAIXA, transaction_type: 'CREDIT', amount: 10000, bank_ref: 'AR:r1' })
    banco.transacao({ account_id: 'asaas1', transaction_type: 'DEBIT', amount: 10000, bank_ref: 'pay_c-refund' })
    // F7-D: com o dinheiro do Caixa ainda contando, a tela pergunta; respondido "o mesmo", só a claim.
    expect((await receber({ received_amount: 10000, account_id: CAIXA })).status).toBe(409)
    const { j } = await receber({ received_amount: 10000, account_id: CAIXA, dinheiro: 'mesmo' })
    expect(j.data.aviso).toBeTruthy()
    expect(creditosAR()).toHaveLength(1)
    expect(banco.saldo(CAIXA)).toBe(10000)
  })
})

describe('F7-D (#8, #13): Receber pela tela pergunta quando a conta já tem dinheiro lançado', () => {
  const INTER = '55555555-5555-4555-8555-555555555555'
  const CAIXA = '33333333-3333-4333-8333-333333333333'
  const comCnab = () => {
    banco.conta({ id: INTER, name: 'Banco Inter', current_balance: 50000 })
    banco.ar({ ...AR, total_amount: 50000, account_id: INTER, pix_code: JSON.stringify({ nossoNumero: '123' }) })
    banco.transacao({ account_id: INTER, transaction_type: 'CREDIT', amount: 50000, bank_ref: 'cnab:123', transaction_date: new Date('2026-10-20T00:00:00Z') })
  }

  it('sem `dinheiro` → 409 DINHEIRO_JA_LANCADO com os lançamentos; nada gravado', async () => {
    comCnab()
    const { status, j } = await receber({ received_amount: 50000 })
    expect(status).toBe(409)
    expect(j).toEqual(expect.objectContaining({
      code: 'DINHEIRO_JA_LANCADO',
      error: expect.stringMatching(/^Esta conta já tem dinheiro lançado: .*R\$ 500,00 em 20\/10\/2026.*É um novo pagamento\?$/),
      lancados: [{ id: expect.any(String), origem: 'boleto (CNAB) cnab:123', valor_centavos: 50000, data: '2026-10-20', conta: 'Banco Inter' }],
    }))
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0 }))
    expect(banco.tx.account.update).not.toHaveBeenCalled()
  })

  it("`dinheiro: 'novo'` → baixa normal: CREDIT AR:r1 na conta pedida, ignorando o dinheiro antigo", async () => {
    comCnab()
    const { status, j } = await receber({ received_amount: 50000, dinheiro: 'novo' })
    expect(status).toBe(200)
    expect(j.data).not.toHaveProperty('aviso')
    expect(creditosAR()).toEqual([expect.objectContaining({ account_id: ACC, amount: 50000 })])
    expect(banco.saldo(ACC)).toBe(150000)
  })

  it("#8: AR da maquininha estornada (crédito acquirer: vivo), Receber no Caixa com 'novo' → CREDIT no Caixa", async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 0 })
    banco.ar({ ...AR, total_amount: 10000, account_id: ACC })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1', status: 'RECEIVED' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'acquirer:rede:NSU1' })
    expect((await receber({ received_amount: 10000, account_id: CAIXA })).status).toBe(409)
    const { j } = await receber({ received_amount: 10000, account_id: CAIXA, dinheiro: 'novo' })
    expect(j.data.ligada).toBe(false)
    expect(creditosAR()).toEqual([expect.objectContaining({ account_id: CAIXA, amount: 10000 })])
    expect(banco.saldo(CAIXA)).toBe(10000)
  })

  it('#13 → F8-A (§0): estorno feito em produção (DEBIT AR:r1:estorno no Itaú) desconta o crédito do adquirente da MESMA conta → lança sem perguntar', async () => {
    banco.ar({ ...AR, total_amount: 10000, account_id: ACC })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1', status: 'RECEIVED' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'acquirer:rede:NSU1' })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'AR:r1:estorno' })
    const { status } = await receber({ received_amount: 10000 })
    expect(status).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'AR:r1')).toEqual([expect.objectContaining({ transaction_type: 'CREDIT', amount: 10000, account_id: ACC })])
  })

  it('F8-A: o :estorno só desconta dinheiro da MESMA conta — crédito do adquirente em outra conta continua perguntando', async () => {
    banco.conta({ id: CAIXA, current_balance: 0 })
    banco.ar({ ...AR, total_amount: 10000, account_id: ACC })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1', status: 'RECEIVED' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'acquirer:rede:NSU1' })
    banco.transacao({ account_id: CAIXA, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'AR:r1:estorno' })
    const { status, j } = await receber({ received_amount: 10000 })
    expect(status).toBe(409)
    expect(j.lancados).toEqual([expect.objectContaining({ origem: 'maquininha acquirer:rede:NSU1', valor_centavos: 9700 })])
  })
})

describe('F8-C: linhas livres desligadas desta AR (Desfazer) também fazem o Receber perguntar', () => {
  const CAIXA = '33333333-3333-4333-8333-333333333333'
  const desligada = (id: string, over: Record<string, unknown> = {}) => banco.transacao({
    id, account_id: ACC, transaction_type: 'CREDIT', amount: 15000, origin: 'BANCO', bank_ref: `ITAU:${id}`, source_text: `PIX ${id}`,
    category_id: 'cat:Receita a identificar', transaction_date: new Date('2026-09-01T00:00:00Z'), linked_ref: null, desligada_de: 'AR:r1', ...over,
  })

  it('linha desligada desta AR, de OUTRO valor → 409 DINHEIRO_JA_LANCADO com a linha; nada gravado', async () => {
    banco.ar(AR)
    desligada('d1', { amount: 10000 })
    const { status, j } = await receber()
    expect(status).toBe(409)
    expect(j.code).toBe('DINHEIRO_JA_LANCADO')
    expect(j.lancados).toEqual([expect.objectContaining({ valor_centavos: 10000, data: '2026-09-01', origem: 'linha do extrato desligada (AR:r1)' })])
    expect(ar().status).toBe('PENDENTE')
    expect(creditosAR()).toEqual([])
  })

  it("'mesmo' → religa TODAS as linhas desligadas desta AR (em qualquer conta) e marca recebida; nenhum crédito novo nem saldo", async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 7500 })
    banco.ar(AR)
    desligada('d1', { amount: 7500 })
    desligada('d2', { amount: 7500, account_id: CAIXA })
    const { status, j } = await receber({ dinheiro: 'mesmo' })
    expect(status).toBe(200)
    expect(j.data).toEqual(expect.objectContaining({ status: 'RECEBIDO', ligada: true }))
    for (const id of ['d1', 'd2']) expect(banco.tx_(id)).toEqual(expect.objectContaining({ linked_ref: 'AR:r1', desligada_de: null }))
    expect(creditosAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(banco.saldo(CAIXA)).toBe(7500)
    expect(banco.travas.filter((t) => t.tabela === 'accounts').map((t) => t.id).sort()).toEqual([ACC, CAIXA].sort())
  })

  it("'novo' → baixa normal, sem tomar a linha desligada desta AR (mesmo valor, na janela)", async () => {
    banco.ar(AR)
    desligada('d1', { transaction_date: new Date('2026-10-28T00:00:00Z') })
    const { status, j } = await receber({ dinheiro: 'novo' })
    expect(status).toBe(200)
    expect(j.data.ligada).toBe(false)
    expect(creditosAR()).toEqual([expect.objectContaining({ amount: 15000, account_id: ACC })])
    expect(banco.tx_('d1')).toEqual(expect.objectContaining({ linked_ref: null, desligada_de: 'AR:r1' }))
    expect(banco.saldo(ACC)).toBe(115000)
  })

  it('m8: linha desligada em categoria fora do total (Estornos/transferência) não conta nem é religada', async () => {
    banco.ar(AR)
    desligada('d1', { category_id: 'cat:Transferência entre contas', transaction_date: new Date('2026-10-28T00:00:00Z') })
    const { status } = await receber()
    expect(status).toBe(200)
    expect(banco.tx_('d1')!.linked_ref).toBeNull()
    expect(creditosAR()).toHaveLength(1)
  })

  it("'mesmo' com linha desligada que apareceu numa conta não travada → 409 'conta alterada — repita', nada gravado", async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 0 })
    banco.ar(AR)
    desligada('d1')
    banco.aoTravar(({ tabela }) => {
      if (tabela === 'accounts_receivable') { desligada('d2', { amount: 100, account_id: CAIXA }); banco.aoTravar(null) }
    })
    const { status, j } = await receber({ dinheiro: 'mesmo' })
    expect(status).toBe(409)
    expect(j.error).toBe('conta alterada — repita')
    expect(banco.tx_('d1')!.linked_ref).toBeNull()
    expect(ar().status).toBe('PENDENTE')
  })
})

describe('F8-E (m4): a resposta do Receber vale para a lista que o operador viu (lancados_vistos)', () => {
  const INTER = '55555555-5555-4555-8555-555555555555'
  const prep = () => {
    banco.conta({ id: INTER, name: 'Banco Inter', current_balance: 50000 })
    banco.ar({ ...AR, total_amount: 50000, account_id: INTER, pix_code: JSON.stringify({ nossoNumero: '123' }) })
    banco.transacao({ id: 'cn', account_id: INTER, transaction_type: 'CREDIT', amount: 50000, bank_ref: 'cnab:123', transaction_date: new Date('2026-10-20T00:00:00Z') })
  }

  it('o 409 traz o id de cada lançamento', async () => {
    prep()
    const { j } = await receber({ received_amount: 50000 })
    expect(j.lancados).toEqual([expect.objectContaining({ id: 'cn', valor_centavos: 50000 })])
  })

  it("'mesmo' com a mesma lista → só marca recebida", async () => {
    prep()
    const { status, j } = await receber({ received_amount: 50000, dinheiro: 'mesmo', lancados_vistos: ['cn'] })
    expect(status).toBe(200)
    expect(j.data.status).toBe('RECEBIDO')
    expect(creditosAR()).toEqual([])
  })

  it("'mesmo', mas o dinheiro mostrado sumiu (ex.: reembolso no meio) → 409 'mudou', nada gravado", async () => {
    prep()
    banco.tabelas.transaction = banco.tabelas.transaction.filter((t) => t.id !== 'cn')
    const { status, j } = await receber({ received_amount: 50000, dinheiro: 'mesmo', lancados_vistos: ['cn'] })
    expect(status).toBe(409)
    expect(j.error).toBe('o dinheiro lançado desta conta mudou — confira de novo')
    expect(ar().status).toBe('PENDENTE')
    expect(creditosAR()).toEqual([])
  })

  it("'novo', mas entrou dinheiro que não estava na lista → pergunta de novo com a lista nova", async () => {
    prep()
    banco.transacao({ id: 'nv', account_id: INTER, transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:r1', transaction_date: new Date('2026-10-29T00:00:00Z') })
    const { status, j } = await receber({ received_amount: 50000, dinheiro: 'novo', lancados_vistos: ['cn'] })
    expect(status).toBe(409)
    expect(j.code).toBe('DINHEIRO_JA_LANCADO')
    expect(j.lancados.map((l: { id: string }) => l.id).sort()).toEqual(['cn', 'nv'])
    expect(creditosAR()).toHaveLength(1)
  })
})

