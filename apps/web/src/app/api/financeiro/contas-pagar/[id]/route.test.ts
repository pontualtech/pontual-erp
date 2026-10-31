import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = { apFindFirst: vi.fn(), apUpdateMany: vi.fn(), txFindFirst: vi.fn() }
  const db = {
    accountPayable: { findFirst: m.apFindFirst, updateMany: m.apUpdateMany },
    transaction: { findFirst: m.txFindFirst },
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
})

describe('DELETE conta a pagar — livro-razão (F9)', () => {
  it('AP pendente com lançamento do banco ligado: 409 e nada apagado', async () => {
    m.txFindFirst.mockResolvedValue({ id: 't1' })
    const res = await DELETE(req(), { params: { id: 'p1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/lançamento do banco ligado; estorne antes/)
    expect(m.txFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { company_id: 'c1', linked_ref: 'AP:p1' } }))
    expect(m.apUpdateMany).not.toHaveBeenCalled()
  })

  it('AP pendente sem lançamento ligado: exclui (soft delete) como hoje', async () => {
    const res = await DELETE(req(), { params: { id: 'p1' } })
    expect(res.status).toBe(200)
    expect(m.apUpdateMany).toHaveBeenCalledWith({ where: { id: 'p1', company_id: 'c1' }, data: { deleted_at: expect.any(Date) } })
  })

  it('AP paga continua bloqueada pelo guard antigo (409)', async () => {
    m.apFindFirst.mockResolvedValue({ ...AP, status: 'PAGO', paid_amount: 5000 })
    const res = await DELETE(req(), { params: { id: 'p1' } })
    expect(res.status).toBe(409)
    expect(m.apUpdateMany).not.toHaveBeenCalled()
  })
})
