import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = {
    arFindFirst: vi.fn(), arUpdateMany: vi.fn(), arFindFirstOrThrow: vi.fn(), arFindMany: vi.fn(),
    apFindFirst: vi.fn(), apUpdate: vi.fn(),
    accFindFirst: vi.fn(), accUpdate: vi.fn(),
    txFindFirst: vi.fn(), txFindMany: vi.fn(), txCreate: vi.fn(), txUpdateMany: vi.fn(),
    catFindFirst: vi.fn(),
  }
  const db = {
    accountReceivable: { findFirst: m.arFindFirst, updateMany: m.arUpdateMany, findFirstOrThrow: m.arFindFirstOrThrow, findMany: m.arFindMany },
    accountPayable: { findFirst: m.apFindFirst, update: m.apUpdate },
    account: { findFirst: m.accFindFirst, update: m.accUpdate },
    transaction: { findFirst: m.txFindFirst, findMany: m.txFindMany, create: m.txCreate, updateMany: m.txUpdateMany },
    category: { findFirst: m.catFindFirst },
    $transaction: async (cb: (tx: unknown) => unknown) => cb(db),
  }
  return { m, db }
})
vi.mock('@pontual/db', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { POST } from './route'

const ACC = '11111111-1111-4111-8111-111111111111'
const AR = {
  id: 'r1', status: 'PENDENTE', reconciled: false, total_amount: 15000, received_amount: 0, description: 'OS 1',
  category_id: null, card_fee_total: null, service_order_id: null, group_id: null,
}
const req = (body: unknown) => new NextRequest('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const livro = (over: Record<string, unknown> = {}) => ({
  id: 't1', amount: 15000, transaction_type: 'CREDIT', transaction_date: new Date('2026-10-28T00:00:00Z'),
  linked_ref: null, origin: 'BANCO', categories: { name: 'Receita a identificar' }, ...over,
})
const receber = () => POST(req({ received_amount: 15000, account_id: ACC, received_at: '2026-10-29' }), { params: { id: 'r1' } })

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.arFindFirst.mockResolvedValue(AR)
  m.arFindFirstOrThrow.mockResolvedValue({ ...AR, status: 'RECEBIDO', received_amount: 15000 })
  m.arUpdateMany.mockResolvedValue({ count: 1 })
  m.accFindFirst.mockResolvedValue({ id: ACC, is_active: true })
  m.txFindFirst.mockResolvedValue({ source_text: 'PIX RECEBIDO FULANO' })
  m.txUpdateMany.mockResolvedValue({ count: 1 })
  m.catFindFirst.mockImplementation(async ({ where }: any) => (where.name ? { id: `cat:${where.name}` } : { name: 'Outra' }))
})

describe('Receber (baixa de AR) — livro-razão', () => {
  it('liga ao lançamento do banco em fallback: sem transaction.create e sem account.update', async () => {
    m.txFindMany.mockResolvedValue([livro()])
    const res = await receber()
    const j = await res.json()
    expect(res.status).toBe(200)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).toHaveBeenCalledWith({
      where: { id: 't1', company_id: 'c1', linked_ref: null },
      data: {
        linked_ref: 'AR:r1', category_id: 'cat:Venda de Servicos',
        description: 'Recebimento: OS 1 · banco: PIX RECEBIDO FULANO', reconciled: true,
      },
    })
    expect(j.data.ligada).toBe(true)
    expect(j.data.id).toBe('r1')
    expect(j.data.status).toBe('RECEBIDO')
  })

  it('linha já categorizada (Venda de Servicos): liga e mantém a categoria da linha', async () => {
    m.txFindMany.mockResolvedValue([livro({ categories: { name: 'Venda de Servicos' } })])
    const j = await (await receber()).json()
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany.mock.calls[0][0].data).not.toHaveProperty('category_id')
    expect(j.data.ligada).toBe(true)
  })

  it('sem candidato: cria o crédito e soma no saldo como hoje', async () => {
    m.txFindMany.mockResolvedValue([])
    const j = await (await receber()).json()
    expect(j.data.ligada).toBe(false)
    expect(m.txUpdateMany).not.toHaveBeenCalled()
    expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' }) })
    expect(m.accUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ current_balance: { increment: 15000 } }) }))
  })

  it('linha já ligada por outra baixa (count 0): 409, sem criar nem creditar', async () => {
    m.txFindMany.mockResolvedValue([livro()])
    m.txUpdateMany.mockResolvedValue({ count: 0 })
    const res = await receber()
    expect(res.status).toBe(409)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })
})
