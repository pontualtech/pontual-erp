import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { POST as estornar } from './route'
import { POST as pagar } from '../baixa/route'
import { POST as lancarLinhas } from '../../../livro/linhas/route'
import { banco } from '@/test-utils/banco-falso'

const ACC = '11111111-1111-4111-8111-111111111111'
const ACC2 = '22222222-2222-4222-8222-222222222222'
const dia = (d: string) => new Date(`${d}T00:00:00.000Z`)
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const est = async (id = 'p1', corpo: Record<string, unknown> = {}) => {
  const res = await estornar(new NextRequest('http://x/api', json(corpo)), { params: { id } })
  return { status: res.status, j: await res.json() }
}
const ap = (id = 'p1') => banco.tabelas.accountPayable.find((a) => a.id === id)!
const doAP = (id = 'p1') => banco.tabelas.transaction.filter((t) => t.bank_ref?.startsWith(`AP:${id}`))

beforeEach(() => {
  banco.reset()
  banco.categoriasPadrao()
  banco.conta({ id: ACC, current_balance: 100000 })
  banco.conta({ id: ACC2, current_balance: 0 })
})

describe('§3 estorno de AP', () => {
  it("(b) F12-B: 'devolvido' com DEBIT AP:id não convertidos → CREDIT AP:id:estorno na conta de cada saída; os DEBIT ficam (compensados)", async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 3000, bank_ref: 'AP:p1' })
    banco.transacao({ account_id: ACC2, transaction_type: 'DEBIT', amount: 2000, bank_ref: 'AP:p1' })
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'AP:p1')).toHaveLength(2)
    expect(banco.saldo(ACC)).toBe(103000)
    expect(banco.saldo(ACC2)).toBe(2000)
    expect(doAP().filter((t) => t.bank_ref === 'AP:p1:estorno').map((t) => [t.account_id, t.amount]).sort()).toEqual([[ACC, 3000], [ACC2, 2000]])
  })

  it('(b) já compensado antes e PENDENTE/0: 400 "nada a estornar" (m7)', async () => {
    banco.ap({ id: 'p1', status: 'PENDENTE', account_id: ACC, paid_amount: 0, total_amount: 10000 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'AP:p1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 10000, bank_ref: 'AP:p1:estorno' })
    const { status, j } = await est()
    expect(status).toBe(400)
    expect(j.error).toBe('nada a estornar')
  })

  it('PAGO com paid_amount 0 mas DEBIT próprio: aceita e compensa (antes 400)', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 0, total_amount: 5000 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1' })
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(105000)
  })

  it('(c) #13: paga antes de 22/05 (DEBIT sem bank_ref): CREDIT paid_amount na conta da AP como o código antigo', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 300000, total_amount: 300000, updated_at: new Date('2026-05-05T15:00:00Z'), created_at: new Date('2026-05-01T12:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 300000, bank_ref: null, description: 'Pgto: Aluguel maio' })
    expect((await est()).status).toBe(200)
    expect(doAP()).toEqual([expect.objectContaining({ bank_ref: 'AP:p1:estorno', transaction_type: 'CREDIT', amount: 300000, account_id: ACC })])
    expect(banco.saldo(ACC)).toBe(400000)
  })

  it('(d) paga depois de 22/05 sem lançamento próprio nem linha: só status', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000, updated_at: new Date('2026-07-01T15:00:00Z') })
    expect((await est()).status).toBe(200)
    expect(doAP()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ap().status).toBe('PENDENTE')
  })

  it('CANCELADO: 400; PENDENTE sem valor nem lançamento: 400 "nada a estornar"', async () => {
    banco.ap({ id: 'p1', status: 'CANCELADO', account_id: ACC, paid_amount: 0, total_amount: 5000 })
    expect((await est()).status).toBe(400)
    banco.ap({ id: 'p2', status: 'PENDENTE', account_id: ACC, paid_amount: 0, total_amount: 5000 })
    expect((await est('p2')).j.error).toBe('nada a estornar')
  })

  it('§7/§10: trava accounts → AP, decide pela releitura (DEBIT comitado enquanto esperava) e não usa o cliente de fora', async () => {
    banco.ap({ id: 'p1', status: 'PENDENTE', account_id: ACC, paid_amount: 0, total_amount: 5000 })
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts_payable') return
      banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1' })
      Object.assign(ap(), { status: 'PAGO', paid_amount: 5000 })
    })
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.travas.map((t) => t.tabela)).toEqual(['accounts', 'accounts_payable'])
    expect(banco.saldo(ACC)).toBe(105000)
    expect(banco.prismaDentroDaTx()).toEqual([])
  })

  it("#2/#11: Pagar 1200 → livro liga o DEBIT (órfão) → estornar mover_para a AP certa: a linha passa para ela, nada novo, uma saída de 1200", async () => {
    const CORTE = '2026-10-29', DATA = '2026-11-02'
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, bank_ref: `AJUSTE:${ACC}:${CORTE}`, origin: 'AJUSTE', transaction_date: dia(CORTE) })
    banco.ap({ id: 'errada', status: 'PENDENTE', total_amount: 120000, description: 'Boleto A' })
    banco.ap({ id: 'certa', status: 'PENDENTE', total_amount: 120000, description: 'Boleto B' })
    const pagarAP = (id: string) => pagar(new NextRequest('http://x/api', json({ paid_amount: 120000, account_id: ACC, paid_at: DATA })), { params: { id } })
    expect((await pagarAP('errada')).status).toBe(200)
    const linhas = await lancarLinhas(new NextRequest('http://x/api', json({
      account_id: ACC, corte: CORTE, linhas: [{ chave: `ITAU:${DATA}|BOLETO|-120000|1`, data: DATA, descricao: 'BOLETO', valor_centavos: -120000 }],
    })))
    expect((await linhas.json()).data.resultados[0]).toEqual(expect.objectContaining({ acao: 'LIGAR', origem: 'orfao' }))
    const n = banco.tabelas.transaction.length
    const { status, j } = await est('errada', { mover_para: 'certa' })
    expect(status).toBe(200)
    expect(j.data.movido_para).toBe('certa')
    expect(banco.tabelas.transaction.find((t) => t.origin === 'BANCO' && t.transaction_type === 'DEBIT')).toEqual(expect.objectContaining({ linked_ref: 'AP:certa', description: 'Pgto: Boleto B · banco: BOLETO' }))
    expect(banco.tabelas.transaction.length).toBe(n)
    expect(ap('errada')).toEqual(expect.objectContaining({ status: 'PENDENTE', paid_amount: 0 }))
    expect(ap('certa')).toEqual(expect.objectContaining({ status: 'PAGO', paid_amount: 120000 }))
    expect(banco.saldo(ACC)).toBe(100000 - 120000)
  })
})

describe('F2-A: AP da taxa do adquirente não é estornável', () => {
  it("payment_method 'Desconto automatico' ou notes.source 'acquirer_match' → 409, nada muda", async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 300, total_amount: 300, payment_method: 'Desconto automatico' })
    banco.ap({ id: 'p2', status: 'PAGO', account_id: ACC, paid_amount: 300, total_amount: 300, notes: JSON.stringify({ source: 'acquirer_match', fee_type: 'MDR' }) })
    for (const id of ['p1', 'p2']) {
      const { status, j } = await est(id)
      expect(status).toBe(409)
      expect(j.error).toBe('taxa descontada no repasse do adquirente — não estornável')
      expect(ap(id).status).toBe('PAGO')
    }
    expect(banco.tabelas.transaction).toEqual([])
  })
})

describe('F2-D (m9): conflito do banco no estorno de AP', () => {
  it('P2034/P2028 → 409 "conflito com outra operação — repita"', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1' })
    for (const code of ['P2034', 'P2028']) {
      banco.tx.transaction.create.mockImplementationOnce(async () => { throw Object.assign(new Error('conflito'), { code }) })
      const { status, j } = await est('p1', { dinheiro: 'devolvido' })
      expect(status).toBe(409)
      expect(j.error).toBe('conflito com outra operação — repita')
    }
    expect(ap().status).toBe('PAGO')
  })
})

describe('F2-E (#5, m4): legado detectado pela própria transação', () => {
  it('AP paga em 10/05 (DEBIT sem bank_ref) e conferida/editada em 25/05 (updated_at novo): compensa o paid_amount', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, description: 'Aluguel', updated_at: new Date('2026-05-25T15:00:00Z'), created_at: new Date('2026-05-01T12:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 120000, bank_ref: null, description: 'Pgto: Aluguel', created_at: new Date('2026-05-10T15:00:00Z') })
    expect((await est()).status).toBe(200)
    expect(doAP()).toEqual([expect.objectContaining({ bank_ref: 'AP:p1:estorno', transaction_type: 'CREDIT', amount: 120000, account_id: ACC })])
    expect(banco.saldo(ACC)).toBe(220000)
  })

  it('"Pgto: Aluguel" de outra conta, de linha do banco, de outro valor ou de depois de 22/05: (d) só status', async () => {
    // Fix 4 (F4-A, #8): AP antiga e descrição no formato certo — só conta/origem/valor/data separam do positivo acima.
    for (const extra of [{ account_id: ACC2 }, { origin: 'BANCO' }, { amount: 99000 }, { created_at: new Date('2026-06-10T15:00:00Z') }]) {
      banco.reset(); banco.categoriasPadrao(); banco.conta({ id: ACC, current_balance: 100000 }); banco.conta({ id: ACC2, current_balance: 0 })
      banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, description: 'Aluguel', updated_at: new Date('2026-05-25T15:00:00Z'), created_at: new Date('2026-05-01T12:00:00Z') })
      banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 120000, bank_ref: null, description: 'Pgto: Aluguel', created_at: new Date('2026-05-10T15:00:00Z'), ...extra })
      expect((await est()).status, JSON.stringify(extra)).toBe(200)
      expect(doAP(), JSON.stringify(extra)).toEqual([])
      expect(banco.saldo(ACC)).toBe(100000)
    }
  })
})

describe("F2-G (#12) → F10-B: DEBIT AP:id com marcador antigo LIGADA é dinheiro próprio", () => {
  it("source_text LIGADA:… e origin null (saída já confirmada pelo banco): pergunta; 'devolvido' → só o sufixo :devolvido, nada lançado", async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1', source_text: 'LIGADA:ITAU:k' })
    expect((await est()).status).toBe(409)
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'AP:p1:devolvido')).toHaveLength(1)
    expect(doAP().filter((t) => t.bank_ref === 'AP:p1:estorno')).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('m21: a tx do estorno usa maxWait 10s e timeout 20s', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000 })
    await est()
    expect(banco.transacoes.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }])
  })
})

describe('F3-A (espelho na AP): legado (c) só em conta antiga e com o "Pgto: …" certo', () => {
  const MAIO = new Date('2026-05-10T15:00:00Z')
  const RECENTE = new Date('2026-10-30T15:00:00Z')
  const debitoLegado = (extra: Record<string, unknown> = {}) =>
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 120000, bank_ref: null, description: 'Pgto: Aluguel abril', created_at: MAIO, ...extra })

  it('(iii) AP criada depois de 22/05 + DEBIT antigo do mesmo valor e da MESMA descrição → (d)', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, description: 'Aluguel abril', updated_at: RECENTE, created_at: new Date('2026-06-01T12:00:00Z') })
    debitoLegado()
    expect((await est()).status).toBe(200)
    expect(doAP()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('(iv) AP antiga, mas o DEBIT antigo não é "Pgto: …" (ou é CREDIT / tem bank_ref) → (d)', async () => {
    for (const extra of [{ description: 'TED qualquer' }, { transaction_type: 'CREDIT' }, { bank_ref: 'AP:outra' }]) {
      banco.reset(); banco.categoriasPadrao(); banco.conta({ id: ACC, current_balance: 100000 })
      banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, description: 'Aluguel abril', updated_at: RECENTE, created_at: new Date('2026-05-01T12:00:00Z') })
      debitoLegado(extra)
      expect((await est()).status).toBe(200)
      expect(doAP()).toEqual([])
      expect(banco.saldo(ACC)).toBe(100000)
    }
  })
})

describe('F3-C (#2): 409 da taxa do adquirente só quando a AP não tem saída própria', () => {
  it("taxa ESTIMADA 'Desconto automatico' paga pelo Receber (DEBIT AP:p1 vivo, conta sem extrato) → 'devolvido': 200 e CREDIT AP:p1:estorno", async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 1500, total_amount: 1500, payment_method: 'Desconto automatico' })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 1500, bank_ref: 'AP:p1' })
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(doAP().filter((t) => t.bank_ref === 'AP:p1:estorno')).toEqual([expect.objectContaining({ transaction_type: 'CREDIT', amount: 1500 })])
    expect(banco.saldo(ACC)).toBe(101500)
  })

  it('taxa do perform-match / capture-fees PAGA sem DEBIT (descontada no repasse) → 409', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 300, total_amount: 300, payment_method: 'Desconto automatico', notes: JSON.stringify({ source: 'acquirer_match' }) })
    banco.ap({ id: 'p2', status: 'PAGO', account_id: ACC, paid_amount: 300, total_amount: 300, notes: JSON.stringify({ source: 'capture-fees' }) })
    for (const id of ['p1', 'p2']) expect((await est(id)).status).toBe(409)
  })

  it("a taxa com linha do banco ligada (AP:p1) também é estornável: pergunta; 'devolvido' (conta com extrato) → a linha fica AP:p1:devolvido, nada lançado", async () => {
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') })
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 1500, total_amount: 1500, payment_method: 'Desconto automatico' })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'DEBIT', amount: 1500, origin: 'BANCO', bank_ref: 'K', source_text: 'TARIFA', linked_ref: 'AP:p1' })
    expect((await est()).status).toBe(409)
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('L')!.linked_ref).toBe('AP:p1:devolvido')
    expect(doAP().filter((t) => t.bank_ref === 'AP:p1:estorno')).toEqual([])
  })
})

describe('F4-A (#1, espelho na AP): legado (c) só com o "Pgto: <descrição desta AP>"', () => {
  it('"Pgto: <outra AP>" de mesmo valor, na conta, antes de 22/05 → (d)', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, description: 'Aluguel junho', updated_at: new Date('2026-10-30T15:00:00Z'), created_at: new Date('2026-05-01T12:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 120000, bank_ref: null, description: 'Pgto: Aluguel abril', created_at: new Date('2026-05-10T15:00:00Z') })
    expect((await est()).status).toBe(200)
    expect(doAP()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })
})

describe("F10-B (AP): 'devolvido' (refs próprias ganham :devolvido) ou mover_para (engano)", () => {
  const PERGUNTA = 'O dinheiro foi devolvido pelo fornecedor, ou lançado na conta errada?'
  const CORTE = '2026-10-29', DATA = '2026-11-02'
  const CAIXA = '33333333-3333-4333-8333-333333333333'
  const ajuste = (conta = ACC) => banco.transacao({ account_id: conta, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${conta}:${CORTE}`, created_at: new Date('2026-10-30T10:00:00Z'), transaction_date: dia(CORTE) })
  const pagarEm = (id: string, data: string, conta = ACC, extra: Record<string, unknown> = {}) =>
    pagar(new NextRequest('http://x/api', json({ paid_amount: 120000, account_id: conta, paid_at: data, ...extra })), { params: { id } })
  const linhaDoBanco = (chave: string, valor: number) => lancarLinhas(new NextRequest('http://x/api', json({
    account_id: ACC, corte: CORTE, linhas: [{ chave, data: DATA, descricao: valor < 0 ? 'BOLETO' : 'DEVOLUCAO FORNECEDOR', valor_centavos: valor }],
  })))
  const estornos = (id = 'p1') => banco.tabelas.transaction.filter((t) => t.bank_ref === `AP:${id}:estorno`)

  it("Pagar → livro converte → estorno sem resposta → 409; 'devolvido' → a linha fica AP:p1:devolvido, nada lançado; a devolução entra pelo extrato; Pagar de novo lança: saldo = banco", async () => {
    ajuste()
    banco.ap({ id: 'p1', status: 'PENDENTE', total_amount: 120000, description: 'Boleto A' })
    await pagarEm('p1', DATA)
    await linhaDoBanco(`ITAU:${DATA}|BOLETO|-120000|1`, -120000)
    const { status, j } = await est('p1')
    expect(status).toBe(409)
    expect(j).toEqual(expect.objectContaining({ code: 'ESTORNO_PERGUNTA', error: PERGUNTA, lancados: [expect.objectContaining({ valor_centavos: 120000 })] }))
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.origin === 'BANCO' && t.linked_ref === 'AP:p1:devolvido')).toHaveLength(1)
    expect(estornos()).toEqual([])
    await linhaDoBanco(`ITAU:${DATA}|DEVOLUCAO FORNECEDOR|+120000|1`, 120000)
    expect(banco.saldo(ACC)).toBe(100000)
    expect((await pagarEm('p1', '2026-11-22')).status).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'AP:p1')).toEqual([expect.objectContaining({ transaction_type: 'DEBIT', amount: 120000 })])
    expect(banco.saldo(ACC)).toBe(100000 - 120000)
  })

  it("F12-B (#5, espelho): Pagar no Itaú sem linha (DEBIT nocional) → 'devolvido' → CREDIT :estorno, saldo volta; a saída e a entrada da devolução chegam → saldo = banco", async () => {
    ajuste()
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: 'TARIFA', source_text: 'TARIFA', transaction_date: dia('2026-10-31') })
    banco.ap({ id: 'p1', status: 'PENDENTE', total_amount: 120000, description: 'Boleto A' })
    await pagarEm('p1', DATA)
    expect(banco.saldo(ACC)).toBe(-20000)
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(estornos()).toEqual([expect.objectContaining({ account_id: ACC, amount: 120000, transaction_type: 'CREDIT' })])
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'AP:p1')).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(100000)
    await linhaDoBanco(`ITAU:${DATA}|BOLETO|-120000|1`, -120000)
    await linhaDoBanco(`ITAU:${DATA}|DEVOLUCAO FORNECEDOR|+120000|1`, 120000)
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it("F13-A (espelho): DEBIT AP:p1 anterior ao ajuste no Itaú (com linha do banco) → só o sufixo, nada lançado; a entrada da devolução chega → saldo = banco; na Inter (sem linha) → CREDIT :estorno", async () => {
    ajuste()
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: 'TARIFA', source_text: 'TARIFA', transaction_date: dia('2026-10-31') })
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000 })
    banco.transacao({ id: 'D', account_id: ACC, transaction_type: 'DEBIT', amount: 120000, bank_ref: 'AP:p1', created_at: new Date('2026-10-20T15:00:00Z') })
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('D')!.bank_ref).toBe('AP:p1:devolvido')
    expect(estornos()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    await linhaDoBanco(`ITAU:${DATA}|DEVOLUCAO FORNECEDOR|+120000|1`, 120000)
    expect(banco.saldo(ACC)).toBe(220000) // banco: 1000,00 + a devolução de 1.200,00

    ajuste(ACC2)
    banco.tabelas.account[1].current_balance = -5000
    banco.ap({ id: 'p2', status: 'PAGO', account_id: ACC2, paid_amount: 5000, total_amount: 5000 })
    banco.transacao({ id: 'E', account_id: ACC2, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p2', created_at: new Date('2026-10-20T15:00:00Z') })
    expect((await est('p2', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('E')!.bank_ref).toBe('AP:p2')
    expect(estornos('p2')).toEqual([expect.objectContaining({ account_id: ACC2, amount: 5000, transaction_type: 'CREDIT' })])
    expect(banco.saldo(ACC2)).toBe(0)
  })

  it("F14-A (espelho): AP legada ('Pgto:' de 10/05 sem bank_ref) no Itaú com AJUSTE e linha do banco → estorno não compensa; a entrada da devolução chega → saldo = banco", async () => {
    ajuste()
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: 'TARIFA', source_text: 'TARIFA', transaction_date: dia('2026-10-31') })
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, description: 'Aluguel', updated_at: new Date('2026-11-01T15:00:00Z'), created_at: new Date('2026-05-01T12:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 120000, bank_ref: null, description: 'Pgto: Aluguel', created_at: new Date('2026-05-10T15:00:00Z'), transaction_date: dia('2026-05-10') })
    expect((await est('p1')).status).toBe(200)
    expect(estornos()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ap()).toEqual(expect.objectContaining({ status: 'PENDENTE', paid_amount: 0 }))
    await linhaDoBanco(`ITAU:${DATA}|DEVOLUCAO FORNECEDOR|+120000|1`, 120000)
    expect(banco.saldo(ACC)).toBe(220000)
  })

  it('m5: mover_para da AP — a linha que levava a categoria da origem passa a levar a do destino', async () => {
    banco.categoria('Aluguel', 'financeiro_despesa')
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000, category_id: 'cat:Energia' })
    banco.ap({ id: 'p2', status: 'PENDENTE', account_id: ACC, paid_amount: 0, total_amount: 5000, category_id: 'cat:Aluguel', description: 'Aluguel' })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'DEBIT', amount: 5000, origin: 'BANCO', bank_ref: 'K', source_text: 'TED', linked_ref: 'AP:p1', category_id: 'cat:Energia' })
    expect((await est('p1', { mover_para: 'p2' })).status).toBe(200)
    expect(banco.tx_('L')).toEqual(expect.objectContaining({ linked_ref: 'AP:p2', category_id: 'cat:Aluguel' }))
  })

  it("#1/#8/#16: depois do 'devolvido', o Pagar da MESMA AP pelo Caixa debita o Caixa (não fica 'já pago')", async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 0 })
    ajuste()
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, description: 'Boleto A' })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'DEBIT', amount: 120000, origin: 'BANCO', bank_ref: 'K', source_text: 'BOLETO', linked_ref: 'AP:p1' })
    await est('p1', { dinheiro: 'devolvido' })
    const r = await (await pagarEm('p1', DATA, CAIXA)).json()
    expect(r.data.aviso).toBeUndefined()
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'AP:p1')).toEqual([expect.objectContaining({ account_id: CAIXA, amount: 120000 })])
    expect(banco.saldo(CAIXA)).toBe(-120000)
  })

  it("#6: depois do 'devolvido', o Pagar com vínculo explícito à saída nova liga essa linha", async () => {
    ajuste()
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, description: 'Boleto A' })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'DEBIT', amount: 120000, origin: 'BANCO', bank_ref: 'K', source_text: 'BOLETO', linked_ref: 'AP:p1' })
    banco.transacao({ id: 'L2', account_id: ACC, transaction_type: 'DEBIT', amount: 120000, origin: 'BANCO', bank_ref: 'K2', source_text: 'BOLETO 2', category_id: 'cat:A classificar', transaction_date: dia(DATA) })
    await est('p1', { dinheiro: 'devolvido' })
    const r = await (await pagarEm('p1', DATA, ACC, { livro_transaction_id: 'L2' })).json()
    expect(r.data.ligada).toBe(true)
    expect(banco.tx_('L2')!.linked_ref).toBe('AP:p1')
  })

  it("'devolvido' no Caixa → CREDIT AP:p1:estorno no Caixa (o DEBIT fica, compensado): o saldo volta; linha confirmada no Itaú → só sufixo", async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: -5000 })
    banco.ap({ id: 'p1', status: 'PAGO', account_id: CAIXA, paid_amount: 5000, total_amount: 5000 })
    banco.transacao({ id: 'D', account_id: CAIXA, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1' })
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('D')!.bank_ref).toBe('AP:p1')
    expect(estornos()).toEqual([expect.objectContaining({ account_id: CAIXA, amount: 5000, transaction_type: 'CREDIT' })])
    expect(banco.saldo(CAIXA)).toBe(0)

    ajuste()
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: 'TARIFA', source_text: 'TARIFA', transaction_date: dia('2026-10-31') }) // Itaú: tem extrato
    banco.ap({ id: 'p2', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000 })
    banco.transacao({ id: 'D2', account_id: ACC, transaction_type: 'DEBIT', amount: 5000, origin: 'BANCO', bank_ref: 'K2', source_text: 'BOLETO', linked_ref: 'AP:p2' })
    expect((await est('p2', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('D2')!.linked_ref).toBe('AP:p2:devolvido')
    expect(estornos('p2')).toEqual([])
  })

  it("Fix 11: conta com AJUSTE mas SEM linha do banco (a Inter) → 'devolvido' compensa (CREDIT AP:p1:estorno); com linha do banco → não", async () => {
    ajuste(ACC2)
    banco.tabelas.account[1].current_balance = -5000
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC2, paid_amount: 5000, total_amount: 5000 })
    banco.transacao({ id: 'D', account_id: ACC2, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1' })
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(estornos()).toEqual([expect.objectContaining({ account_id: ACC2, amount: 5000, transaction_type: 'CREDIT' })])
    expect(banco.saldo(ACC2)).toBe(0)

    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: 'TARIFA', source_text: 'TARIFA', transaction_date: dia('2026-10-31') })
    banco.ap({ id: 'p3', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, origin: 'BANCO', bank_ref: 'K3', source_text: 'BOLETO', linked_ref: 'AP:p3' })
    expect((await est('p3', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(estornos('p3')).toEqual([])
  })

  it('mover_para: destino com saldo em aberto menor → 422; parcial → soma e fica PENDENTE; CANCELADO/inexistente/a própria → 422/404', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000 })
    banco.ap({ id: 'p2', status: 'PENDENTE', account_id: ACC, paid_amount: 2000, total_amount: 6000 })
    banco.ap({ id: 'p3', status: 'PENDENTE', account_id: ACC, paid_amount: 0, total_amount: 20000 })
    banco.ap({ id: 'p4', status: 'CANCELADO', account_id: ACC, paid_amount: 0, total_amount: 20000 })
    banco.transacao({ id: 'D', account_id: ACC, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1' })
    const r = await est('p1', { mover_para: 'p2' })
    expect([r.status, r.j.error]).toEqual([422, 'valor maior que o saldo em aberto da conta de destino'])
    expect((await est('p1', { mover_para: 'p4' })).status).toBe(422)
    expect((await est('p1', { mover_para: 'p1' })).status).toBe(422)
    expect((await est('p1', { mover_para: 'nao-existe' })).status).toBe(404)
    expect(banco.tx_('D')!.bank_ref).toBe('AP:p1')
    expect((await est('p1', { mover_para: 'p3' })).status).toBe(200)
    expect(banco.tx_('D')).toEqual(expect.objectContaining({ bank_ref: 'AP:p3', amount: 5000 }))
    expect(ap('p3')).toEqual(expect.objectContaining({ status: 'PENDENTE', paid_amount: 5000 }))
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('mover_para: travas contas → as duas APs (FOR UPDATE, em ordem de id) → escritas pelo tx', async () => {
    banco.ap({ id: 'z9', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000 })
    banco.ap({ id: 'b1', status: 'PENDENTE', account_id: ACC, paid_amount: 0, total_amount: 5000 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:z9' })
    expect((await est('z9', { mover_para: 'b1' })).status).toBe(200)
    expect(banco.travas.map((t) => [t.tabela, t.id])).toEqual([['accounts', ACC], ['accounts_payable', 'b1'], ['accounts_payable', 'z9']])
    expect(banco.prismaDentroDaTx()).toEqual([])
  })

  it("estorno repetido → 400; resposta inválida (o antigo 'permanece', as duas escolhas) → 400; PAGO sem valor nem lançamento → 400", async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1' })
    for (const corpo of [{ dinheiro: 'permanece' }, { dinheiro: 'devolvido', mover_para: 'p2' }]) expect((await est('p1', corpo)).status).toBe(400)
    expect((await est('p1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect((await est('p1', { dinheiro: 'devolvido' })).j.error).toBe('nada a estornar')
    banco.ap({ id: 'p9', status: 'PAGO', account_id: ACC, paid_amount: 0, total_amount: 5000 })
    expect((await est('p9')).j.error).toBe('nada a estornar')
  })
})

