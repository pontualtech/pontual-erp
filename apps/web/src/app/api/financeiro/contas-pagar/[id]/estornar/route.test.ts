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

// findMany: linhas ligadas (where.linked_ref) × transações próprias da AP (where.bank_ref).
const transacoes = (ligados: unknown[], proprias: unknown[] = []) =>
  m.txFindMany.mockImplementation(async ({ where }: any) => (where.linked_ref ? ligados : proprias))

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.apFindFirst.mockResolvedValue({ id: 'p1', status: 'PAGO', account_id: 'acc1', paid_amount: 5000, description: 'Luz', category_id: 'catEnergia' })
  m.apUpdateMany.mockResolvedValue({ count: 1 })
  m.catFindFirst.mockResolvedValue({ id: 'catAClassificar' })
})

describe('estorno de AP — livro-razão', () => {
  it('AP ligada: desliga o lançamento, sem delete, sem CREDIT e sem mexer no saldo', async () => {
    transacoes([{ id: 't1', amount: 5000, source_text: 'PGTO ENEL', description: 'Pgto: Luz · banco: PGTO ENEL', category_id: 'catEnergia' }])
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

  it('baixa mista (3000 criada + 2000 ligada): desliga e compensa só o resto 3000', async () => {
    transacoes(
      [{ id: 't1', amount: 2000, source_text: 'PGTO ENEL', description: 'x', category_id: 'catEnergia' }],
      [{ amount: 3000, transaction_type: 'DEBIT', bank_ref: 'AP:p1' }],
    )
    await POST(req(), { params: { id: 'p1' } })
    expect(m.txFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { company_id: 'c1', bank_ref: { in: ['AP:p1', 'AP:p1:estorno'] } },
    }))
    expect(m.txUpdate).toHaveBeenCalledTimes(1)
    expect(m.txDelete).not.toHaveBeenCalled()
    expect(m.txCreate).toHaveBeenCalledTimes(1)
    expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ transaction_type: 'CREDIT', amount: 3000 }) })
    expect(m.accUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ current_balance: { increment: 3000 } }) }))
  })

  it('vínculo explícito com diferença (pago 5085, linha 5000): sem CREDIT falso de 85', async () => {
    m.apFindFirst.mockResolvedValue({ id: 'p1', status: 'PAGO', account_id: 'acc1', paid_amount: 5085, description: 'Luz', category_id: 'catEnergia' })
    transacoes([{ id: 't1', amount: 5000, source_text: 'PGTO ENEL', description: 'x', category_id: 'catEnergia' }])
    await POST(req(), { params: { id: 'p1' } })
    expect(m.txUpdate).toHaveBeenCalledTimes(1)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  it('DEBIT próprio já compensado por estorno anterior não é compensado de novo', async () => {
    transacoes(
      [{ id: 't1', amount: 5000, source_text: 'PGTO ENEL', description: 'x', category_id: 'catEnergia' }],
      [{ amount: 5000, transaction_type: 'DEBIT', bank_ref: 'AP:p1' }, { amount: 5000, transaction_type: 'CREDIT', bank_ref: 'AP:p1:estorno' }],
    )
    await POST(req(), { params: { id: 'p1' } })
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  it('linha que já tinha outra categoria (regra) mantém a dela ao desligar', async () => {
    transacoes([{ id: 't1', amount: 5000, source_text: 'ELETROPAULO', description: 'x', category_id: 'catOutra' }])
    await POST(req(), { params: { id: 'p1' } })
    expect(m.txUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { linked_ref: null, category_id: 'catOutra', description: 'ELETROPAULO' },
    })
  })

  it('AP sem lançamento ligado: estorno como hoje (CREDIT + saldo)', async () => {
    transacoes([])
    await POST(req(), { params: { id: 'p1' } })
    expect(m.txCreate).toHaveBeenCalledTimes(1)
    expect(m.accUpdate).toHaveBeenCalledTimes(1)
  })
})
