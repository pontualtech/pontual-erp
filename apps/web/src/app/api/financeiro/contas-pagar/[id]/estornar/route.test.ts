import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = {
    apFindFirst: vi.fn(), apUpdateMany: vi.fn(),
    txFindMany: vi.fn(), txCreate: vi.fn(), txUpdate: vi.fn(), txDelete: vi.fn(),
    accUpdate: vi.fn(), catFindFirst: vi.fn(),
  }
  const db = {
    accountPayable: { findFirst: m.apFindFirst, updateMany: m.apUpdateMany },
    transaction: { findMany: m.txFindMany, create: m.txCreate, update: m.txUpdate, delete: m.txDelete },
    account: { update: m.accUpdate },
    category: { findFirst: m.catFindFirst },
    $transaction: async (cb: (tx: unknown) => unknown) => cb(db),
  }
  return { m, db }
})
vi.mock('@pontual/db', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { POST } from './route'

const req = () => new NextRequest('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.apFindFirst.mockResolvedValue({ id: 'p1', status: 'PAGO', account_id: 'acc1', paid_amount: 5000, description: 'Luz' })
  m.apUpdateMany.mockResolvedValue({ count: 1 })
  m.catFindFirst.mockResolvedValue({ id: 'catAClassificar' })
})

describe('estorno de AP — livro-razão', () => {
  it('AP ligada: desliga o lançamento, sem delete, sem CREDIT e sem mexer no saldo', async () => {
    m.txFindMany.mockResolvedValue([{ id: 't1', source_text: 'PGTO ENEL', description: 'Pgto: Luz · banco: PGTO ENEL' }])
    const res = await POST(req(), { params: { id: 'p1' } })
    expect(res.status).toBe(200)
    expect(m.txUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { linked_ref: null, category_id: 'catAClassificar', description: 'PGTO ENEL' },
    })
    expect(m.txDelete).not.toHaveBeenCalled()
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  it('AP sem lançamento ligado: estorno como hoje (CREDIT + saldo)', async () => {
    m.txFindMany.mockResolvedValue([])
    await POST(req(), { params: { id: 'p1' } })
    expect(m.txCreate).toHaveBeenCalledTimes(1)
    expect(m.accUpdate).toHaveBeenCalledTimes(1)
  })
})
