import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = { apFindFirst: vi.fn(), apUpdateMany: vi.fn(), txFindFirst: vi.fn(), queryRaw: vi.fn() }
  const db = {
    accountPayable: { findFirst: m.apFindFirst, updateMany: m.apUpdateMany },
    transaction: { findFirst: m.txFindFirst },
    $queryRaw: m.queryRaw,
    $transaction: async (cb: (tx: unknown) => unknown) => cb(db),
  }
  return { m, db }
})
vi.mock('@pontual/db', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { DELETE } from './route'

const req = () => new NextRequest('http://x/api', { method: 'DELETE' })
const AP = { id: 'p1', status: 'PENDENTE', paid_amount: 2000, total_amount: 5000 }

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.apFindFirst.mockResolvedValue(AP)
  m.apUpdateMany.mockResolvedValue({ count: 1 })
  m.txFindFirst.mockResolvedValue(null)
  m.queryRaw.mockResolvedValue([{ id: 'p1' }])
})

describe('DELETE conta a pagar — livro-razão (F9)', () => {
  it('AP pendente com lançamento do banco ligado: 409 e nada apagado', async () => {
    m.txFindFirst.mockResolvedValue({ id: 't1' })
    const res = await DELETE(req(), { params: { id: 'p1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Há lançamentos financeiros desta conta; estorne antes de excluir.')
    expect(m.apUpdateMany).not.toHaveBeenCalled()
  })

  it('AP pendente sem lançamento ligado: exclui (soft delete) como hoje', async () => {
    const res = await DELETE(req(), { params: { id: 'p1' } })
    expect(res.status).toBe(200)
    expect(m.apUpdateMany).toHaveBeenCalledWith({ where: { id: 'p1', company_id: 'c1' }, data: { deleted_at: expect.any(Date) } })
  })

  it('E4: transação própria (AP:id, …:estorno) ou linha ligada: 409 e nada apagado; procura dentro da tx travada', async () => {
    m.txFindFirst.mockResolvedValue({ id: 'x1' })
    const res = await DELETE(req(), { params: { id: 'p1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Há lançamentos financeiros desta conta; estorne antes de excluir.')
    expect(m.txFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { company_id: 'c1', OR: [{ bank_ref: { in: ['AP:p1', 'AP:p1:estorno'] } }, { linked_ref: 'AP:p1' }] },
    }))
    const [sql, ...valores] = m.queryRaw.mock.calls[0]
    expect((sql as string[]).join('?')).toBe('SELECT id FROM accounts_payable WHERE id = ? AND company_id = ? FOR UPDATE')
    expect(valores).toEqual(['p1', 'c1'])
    expect(m.txFindFirst.mock.invocationCallOrder[0]).toBeGreaterThan(m.queryRaw.mock.invocationCallOrder[0])
    expect(m.apUpdateMany).not.toHaveBeenCalled()
  })

  it('E4: o soft delete roda na mesma tx, depois da trava e da busca', async () => {
    const res = await DELETE(req(), { params: { id: 'p1' } })
    expect(res.status).toBe(200)
    expect(m.apUpdateMany.mock.invocationCallOrder[0]).toBeGreaterThan(m.txFindFirst.mock.invocationCallOrder[0])
    expect(m.txFindFirst.mock.invocationCallOrder[0]).toBeGreaterThan(m.queryRaw.mock.invocationCallOrder[0])
  })

  it('AP paga continua bloqueada pelo guard antigo (409)', async () => {
    m.apFindFirst.mockResolvedValue({ ...AP, status: 'PAGO', paid_amount: 5000 })
    const res = await DELETE(req(), { params: { id: 'p1' } })
    expect(res.status).toBe(409)
    expect(m.apUpdateMany).not.toHaveBeenCalled()
  })
})
