import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = {
    apFindFirst: vi.fn(), apUpdateMany: vi.fn(), apFindFirstOrThrow: vi.fn(),
    accFindFirst: vi.fn(), accUpdate: vi.fn(),
    txFindFirst: vi.fn(), txFindMany: vi.fn(), txCreate: vi.fn(), txUpdate: vi.fn(), txUpdateMany: vi.fn(),
    catFindFirst: vi.fn(),
  }
  const db = {
    accountPayable: { findFirst: m.apFindFirst, updateMany: m.apUpdateMany, findFirstOrThrow: m.apFindFirstOrThrow },
    account: { findFirst: m.accFindFirst, update: m.accUpdate },
    transaction: { findFirst: m.txFindFirst, findMany: m.txFindMany, create: m.txCreate, update: m.txUpdate, updateMany: m.txUpdateMany },
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
const AP = { id: 'p1', status: 'PENDENTE', total_amount: 5000, paid_amount: 0, description: 'Luz', category_id: 'catEnergia', payment_method: null }
const req = (body: unknown) => new NextRequest('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const livro = (over: Record<string, unknown> = {}) => ({
  id: 't1', amount: 5000, transaction_type: 'DEBIT', transaction_date: new Date('2026-10-28T00:00:00Z'),
  linked_ref: null, origin: 'BANCO', categories: { name: 'A classificar' }, ...over,
})

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.apFindFirst.mockResolvedValue(AP)
  m.apFindFirstOrThrow.mockResolvedValue({ ...AP, status: 'PAGO' })
  m.apUpdateMany.mockResolvedValue({ count: 1 })
  m.accFindFirst.mockResolvedValue({ id: ACC, is_active: true })
  m.txUpdateMany.mockResolvedValue({ count: 1 })
  m.catFindFirst.mockResolvedValue({ name: 'Energia' })
})

describe('baixa de AP — livro-razão', () => {
  it('liga ao lançamento do banco: sem transaction.create e sem account.update', async () => {
    m.txFindMany.mockResolvedValue([livro()])
    m.txFindFirst.mockResolvedValue({ source_text: 'PGTO ENEL' })
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    const j = await res.json()
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', company_id: 'c1', linked_ref: null },
      data: expect.objectContaining({ linked_ref: 'AP:p1', category_id: 'catEnergia', description: 'Pgto: Luz · banco: PGTO ENEL' }),
    }))
    expect(j.data.ligada).toBe(true)
  })

  it('linha já categorizada por regra (Energia): liga sem criar/debitar e mantém a categoria da linha', async () => {
    m.txFindMany.mockResolvedValue([livro({ categories: { name: 'Energia' } })])
    m.txFindFirst.mockResolvedValue({ source_text: 'ELETROPAULO' })
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    const j = await res.json()
    expect(res.status).toBe(200)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).toHaveBeenCalledTimes(1)
    const arg = m.txUpdateMany.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 't1', company_id: 'c1', linked_ref: null })
    expect(arg.data).toEqual({ linked_ref: 'AP:p1', description: 'Pgto: Luz · banco: ELETROPAULO', reconciled: true })
    expect(j.data.ligada).toBe(true)
  })

  it('linha de ajuste de caixa não serve: cria e debita', async () => {
    m.txFindMany.mockResolvedValue([livro({ categories: { name: 'Ajuste de caixa' } })])
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    expect((await res.json()).data.ligada).toBe(false)
    expect(m.txUpdateMany).not.toHaveBeenCalled()
    expect(m.txCreate).toHaveBeenCalledTimes(1)
    expect(m.accUpdate).toHaveBeenCalledTimes(1)
  })

  it('linha já ligada por outra baixa (count 0): 409, sem criar nem debitar', async () => {
    m.txFindMany.mockResolvedValue([livro()])
    m.txFindFirst.mockResolvedValue({ source_text: 'PGTO ENEL' })
    m.txUpdateMany.mockResolvedValue({ count: 0 })
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    expect(res.status).toBe(409)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  it('sem candidato: cria e debita como hoje', async () => {
    m.txFindMany.mockResolvedValue([])
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    expect((await res.json()).data.ligada).toBe(false)
    expect(m.txCreate).toHaveBeenCalledTimes(1)
    expect(m.accUpdate).toHaveBeenCalledTimes(1)
  })

  it('livro_transaction_id inválido: 422 e nada escrito', async () => {
    m.txFindMany.mockResolvedValue([livro({ categories: { name: 'Energia' } })])
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, livro_transaction_id: 't1' }), { params: { id: 'p1' } })
    expect(res.status).toBe(422)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.txUpdate).not.toHaveBeenCalled()
  })
})
