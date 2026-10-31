import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = { arFindFirst: vi.fn(), arUpdateMany: vi.fn(), txFindFirst: vi.fn() }
  const db = {
    accountReceivable: { findFirst: m.arFindFirst, updateMany: m.arUpdateMany },
    transaction: { findFirst: m.txFindFirst },
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
})

describe('DELETE conta a receber — livro-razão (F9)', () => {
  it('AR pendente com lançamento do banco ligado: 409 e nada apagado', async () => {
    m.txFindFirst.mockResolvedValue({ id: 't1' })
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/lançamento do banco ligado; estorne antes/)
    expect(m.txFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { company_id: 'c1', linked_ref: 'AR:r1' } }))
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })

  it('AR pendente sem lançamento ligado: exclui (soft delete) como hoje', async () => {
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
    expect(m.arUpdateMany).toHaveBeenCalledWith({ where: { id: 'r1', company_id: 'c1' }, data: { deleted_at: expect.any(Date) } })
  })

  it('AR recebida continua bloqueada pelo guard antigo (409)', async () => {
    m.arFindFirst.mockResolvedValue({ ...AR, status: 'RECEBIDO', received_amount: 15000 })
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })
})
