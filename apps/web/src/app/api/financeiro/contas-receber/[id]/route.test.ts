import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = { arFindFirst: vi.fn(), arUpdateMany: vi.fn(), txFindFirst: vi.fn(), queryRaw: vi.fn() }
  const db = {
    accountReceivable: { findFirst: m.arFindFirst, updateMany: m.arUpdateMany },
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
const AR = { id: 'r1', status: 'PENDENTE', received_amount: 5000, total_amount: 15000, reconciled: false }

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.arFindFirst.mockResolvedValue(AR)
  m.arUpdateMany.mockResolvedValue({ count: 1 })
  m.txFindFirst.mockResolvedValue(null)
  m.queryRaw.mockResolvedValue([{ id: 'r1' }])
})

describe('DELETE conta a receber — livro-razão (F9)', () => {
  it('AR pendente com lançamento do banco ligado: 409 e nada apagado', async () => {
    m.txFindFirst.mockResolvedValue({ id: 't1' })
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Há lançamentos financeiros desta conta; estorne antes de excluir.')
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })

  it('AR pendente sem lançamento ligado: exclui (soft delete) como hoje', async () => {
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
    expect(m.arUpdateMany).toHaveBeenCalledWith({ where: { id: 'r1', company_id: 'c1' }, data: { deleted_at: expect.any(Date) } })
  })

  it('E4: transação própria (AR:id, …:estorno, …:anticipation) ou linha ligada: 409 e nada apagado; procura dentro da tx travada', async () => {
    m.txFindFirst.mockResolvedValue({ id: 'x1' })
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Há lançamentos financeiros desta conta; estorne antes de excluir.')
    expect(m.txFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { company_id: 'c1', OR: [{ bank_ref: { in: ['AR:r1', 'AR:r1:anticipation', 'AR:r1:estorno'] } }, { linked_ref: 'AR:r1' }] },
    }))
    const [sql, ...valores] = m.queryRaw.mock.calls[0]
    expect((sql as string[]).join('?')).toBe('SELECT id FROM accounts_receivable WHERE id = ? AND company_id = ? FOR UPDATE')
    expect(valores).toEqual(['r1', 'c1'])
    expect(m.txFindFirst.mock.invocationCallOrder[0]).toBeGreaterThan(m.queryRaw.mock.invocationCallOrder[0])
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })

  it('E4: o soft delete roda na mesma tx, depois da trava e da busca', async () => {
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
    expect(m.arUpdateMany.mock.invocationCallOrder[0]).toBeGreaterThan(m.txFindFirst.mock.invocationCallOrder[0])
    expect(m.txFindFirst.mock.invocationCallOrder[0]).toBeGreaterThan(m.queryRaw.mock.invocationCallOrder[0])
  })

  it('AR recebida continua bloqueada pelo guard antigo (409)', async () => {
    m.arFindFirst.mockResolvedValue({ ...AR, status: 'RECEBIDO', received_amount: 15000 })
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })
})
