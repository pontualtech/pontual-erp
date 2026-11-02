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
    const leituraCandidatos = banco.log.find((o) => o.modelo === 'transaction' && o.op === 'findMany')!
    expect(leituraCandidatos.cliente).toBe('tx')
    expect(leituraCandidatos.seq).toBeGreaterThan(depois)
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
    const { status, j } = await receber({ received_amount: 50000 })
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
    const { j } = await receber()
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

