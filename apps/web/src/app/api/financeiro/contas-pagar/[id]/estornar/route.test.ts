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
const est = async (id = 'p1') => {
  const res = await estornar(new NextRequest('http://x/api', json({})), { params: { id } })
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
  it('(a) linha do banco ligada (linked_ref AP:id): desliga — regra ou "A classificar", texto do banco; sem CREDIT nem saldo', async () => {
    banco.regra({ pattern: 'ELETROPAULO', direction: 'OUT', category_id: 'cat:Energia', priority: 10 })
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000, category_id: 'cat:Energia' })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'DEBIT', amount: 5000, origin: 'BANCO', bank_ref: 'K1', source_text: 'ELETROPAULO 123', linked_ref: 'AP:p1', category_id: 'cat:Energia' })
    banco.transacao({ id: 'M', account_id: ACC, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: 'K2', source_text: 'BOLETO X', linked_ref: 'AP:p1', category_id: 'cat:Energia' })
    expect((await est()).status).toBe(200)
    expect(banco.tx_('L')).toEqual(expect.objectContaining({ linked_ref: null, category_id: 'cat:Energia', description: 'ELETROPAULO 123' }))
    expect(banco.tx_('M')).toEqual(expect.objectContaining({ linked_ref: null, category_id: 'cat:A classificar' }))
    expect(doAP()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ap()).toEqual(expect.objectContaining({ status: 'PENDENTE', paid_amount: 0, reconciled: false }))
  })

  it('(b) DEBIT AP:id: CREDIT AP:id:estorno na conta do débito, um por conta', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 3000, bank_ref: 'AP:p1' })
    banco.transacao({ account_id: ACC2, transaction_type: 'DEBIT', amount: 2000, bank_ref: 'AP:p1' })
    expect((await est()).status).toBe(200)
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
    expect((await est()).status).toBe(200)
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
    expect((await est()).status).toBe(200)
    expect(banco.travas.map((t) => t.tabela)).toEqual(['accounts', 'accounts_payable'])
    expect(banco.saldo(ACC)).toBe(105000)
    expect(banco.prismaDentroDaTx()).toEqual([])
  })

  it('#2: Pagar 1200 → livro liga o DEBIT (órfão) → estornar → Pagar a AP certa: uma saída de 1200 conta uma vez', async () => {
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
    expect((await est('errada')).status).toBe(200)
    const r = await (await pagarAP('certa')).json()
    expect(r.data.ligada).toBe(true)
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
      const { status, j } = await est()
      expect(status).toBe(409)
      expect(j.error).toBe('conflito com outra operação — repita')
    }
    expect(ap().status).toBe('PAGO')
  })
})

describe('F2-E (#5, m4): legado detectado pela própria transação', () => {
  it('AP paga em 10/05 (DEBIT sem bank_ref) e conferida/editada em 25/05 (updated_at novo): compensa o paid_amount', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, updated_at: new Date('2026-05-25T15:00:00Z'), created_at: new Date('2026-05-01T12:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 120000, bank_ref: null, description: 'Pgto: Aluguel', created_at: new Date('2026-05-10T15:00:00Z') })
    expect((await est()).status).toBe(200)
    expect(doAP()).toEqual([expect.objectContaining({ bank_ref: 'AP:p1:estorno', transaction_type: 'CREDIT', amount: 120000, account_id: ACC })])
    expect(banco.saldo(ACC)).toBe(220000)
  })

  it('sem transação legada (valor/tipo/data não batem) e updated_at recente: (d) só status', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, updated_at: new Date('2026-05-25T15:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 99000, bank_ref: null, created_at: new Date('2026-05-10T15:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 120000, bank_ref: null, created_at: new Date('2026-06-10T15:00:00Z') })
    expect((await est()).status).toBe(200)
    expect(doAP()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })
})

describe('F2-G (#12): DEBIT AP:id com marcador antigo LIGADA não é compensado', () => {
  it('source_text LIGADA:… e origin null: nada de CREDIT nem saldo', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 5000, total_amount: 5000 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1', source_text: 'LIGADA:ITAU:k' })
    expect((await est()).status).toBe(200)
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

  it('(iii) AP criada depois de 22/05 + DEBIT antigo do mesmo valor → (d)', async () => {
    banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, updated_at: RECENTE, created_at: new Date('2026-06-01T12:00:00Z') })
    debitoLegado()
    expect((await est()).status).toBe(200)
    expect(doAP()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('(iv) AP antiga, mas o DEBIT antigo não é "Pgto: …" (ou é CREDIT / tem bank_ref) → (d)', async () => {
    for (const extra of [{ description: 'TED qualquer' }, { transaction_type: 'CREDIT' }, { bank_ref: 'AP:outra' }]) {
      banco.reset(); banco.categoriasPadrao(); banco.conta({ id: ACC, current_balance: 100000 })
      banco.ap({ id: 'p1', status: 'PAGO', account_id: ACC, paid_amount: 120000, total_amount: 120000, updated_at: RECENTE, created_at: new Date('2026-05-01T12:00:00Z') })
      debitoLegado(extra)
      expect((await est()).status).toBe(200)
      expect(doAP()).toEqual([])
      expect(banco.saldo(ACC)).toBe(100000)
    }
  })
})
