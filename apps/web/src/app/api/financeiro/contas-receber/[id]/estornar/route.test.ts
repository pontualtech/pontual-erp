import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = {
    arFindFirst: vi.fn(), arUpdateMany: vi.fn(),
    txFindMany: vi.fn(), txCreate: vi.fn(), txUpdate: vi.fn(), txDelete: vi.fn(),
    accUpdate: vi.fn(), catFindFirst: vi.fn(),
  }
  const db = {
    accountReceivable: { findFirst: m.arFindFirst, updateMany: m.arUpdateMany },
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
const AR = { id: 'r1', status: 'LIQUIDADO', account_id: 'acc1', received_amount: 15000, description: 'OS 1', category_id: null }

// findMany: linhas ligadas (where.linked_ref) × transações próprias da AR (where.bank_ref).
const transacoes = (ligados: unknown[], proprias: unknown[] = []) =>
  m.txFindMany.mockImplementation(async ({ where }: any) => (where.linked_ref ? ligados : proprias))

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.arFindFirst.mockResolvedValue(AR)
  m.arUpdateMany.mockResolvedValue({ count: 1 })
  m.catFindFirst.mockImplementation(async ({ where }: any) => ({ id: `cat:${where.name}` }))
})

describe('estorno de AR — livro-razão', () => {
  it('AR ligada: desliga o lançamento (volta a Receita a identificar), sem delete, sem DEBIT e sem mexer no saldo', async () => {
    transacoes([{ id: 't1', amount: 15000, source_text: 'PIX RECEBIDO FULANO', description: 'LIQUIDACAO: OS 1 · banco: x', category_id: 'cat:Venda de Servicos' }])
    const res = await POST(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
    expect(m.txFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { company_id: 'c1', linked_ref: 'AR:r1' } }))
    expect(m.txUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { linked_ref: null, category_id: 'cat:Receita a identificar', description: 'PIX RECEBIDO FULANO' },
    })
    expect(m.txDelete).not.toHaveBeenCalled()
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.arUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDENTE', received_amount: 0 }) }))
  })

  it('linha que já tinha outra categoria mantém a dela ao desligar', async () => {
    transacoes([{ id: 't1', amount: 15000, source_text: 'PIX', description: 'x', category_id: 'cat:Rendimentos' }])
    await POST(req(), { params: { id: 'r1' } })
    expect(m.txUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { linked_ref: null, category_id: 'cat:Rendimentos', description: 'PIX' } })
  })

  it('baixa mista (3000 criada + 12000 ligada): desliga e compensa só o crédito próprio 3000', async () => {
    transacoes(
      [{ id: 't1', amount: 12000, source_text: 'PIX', description: 'x', category_id: 'cat:Venda de Servicos' }],
      [{ amount: 3000, transaction_type: 'CREDIT', bank_ref: 'AR:r1' }],
    )
    await POST(req(), { params: { id: 'r1' } })
    expect(m.txFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { company_id: 'c1', bank_ref: { in: ['AR:r1', 'AR:r1:estorno'] } },
    }))
    expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ transaction_type: 'DEBIT', amount: 3000, bank_ref: 'AR:r1:estorno' }) })
    expect(m.accUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ current_balance: { decrement: 3000 } }) }))
  })

  it('vínculo explícito com diferença (recebido 15085, linha 15000): sem DEBIT falso', async () => {
    m.arFindFirst.mockResolvedValue({ ...AR, received_amount: 15085 })
    transacoes([{ id: 't1', amount: 15000, source_text: 'PIX', description: 'x', category_id: 'cat:Venda de Servicos' }])
    await POST(req(), { params: { id: 'r1' } })
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  it('AR sem lançamento ligado: estorno como hoje (DEBIT + saldo)', async () => {
    transacoes([])
    await POST(req(), { params: { id: 'r1' } })
    expect(m.txUpdate).not.toHaveBeenCalled()
    expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ transaction_type: 'DEBIT', amount: 15000, bank_ref: 'AR:r1:estorno' }) })
    expect(m.accUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ current_balance: { decrement: 15000 } }) }))
  })
})
