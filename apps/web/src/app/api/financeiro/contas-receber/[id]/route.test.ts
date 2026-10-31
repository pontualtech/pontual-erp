import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = { arFindFirst: vi.fn(), arUpdateMany: vi.fn(), txFindFirst: vi.fn(), txFindMany: vi.fn(), queryRaw: vi.fn() }
  const db = {
    accountReceivable: { findFirst: m.arFindFirst, updateMany: m.arUpdateMany },
    transaction: { findFirst: m.txFindFirst, findMany: m.txFindMany },
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
  m.txFindMany.mockResolvedValue([])
  m.queryRaw.mockResolvedValue([{ id: 'r1' }])
})

describe('DELETE conta a receber — livro-razão (F9)', () => {
  const PROPRIOS = 'há lançamentos financeiros desta conta; estorne antes de excluir'
  const LIGADA = 'Há lançamento do banco ligado; estorne antes de excluir.'

  it('AR pendente com lançamento do banco ligado (sem próprio): 409 com o texto da linha ligada, nada apagado', async () => {
    m.txFindFirst.mockResolvedValue({ id: 't1' })
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(LIGADA)
    expect(m.txFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { company_id: 'c1', linked_ref: 'AR:r1' } }))
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })

  it('AR pendente sem lançamento nenhum: exclui (soft delete) como hoje', async () => {
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
    expect(m.arUpdateMany).toHaveBeenCalledWith({ where: { id: 'r1', company_id: 'c1' }, data: { deleted_at: expect.any(Date) } })
  })

  it('E4: lançamento próprio que não se anula (AR:id parcial): 409, nada apagado; busca dentro da tx travada', async () => {
    m.txFindMany.mockResolvedValue([{ bank_ref: 'AR:r1', transaction_type: 'CREDIT', amount: 2000 }])
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PROPRIOS)
    expect(m.txFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { company_id: 'c1', bank_ref: { in: ['AR:r1', 'AR:r1:anticipation', 'AR:r1:estorno'] } } }))
    const [sql, ...valores] = m.queryRaw.mock.calls[0]
    expect((sql as string[]).join('?')).toBe('SELECT id FROM accounts_receivable WHERE id = ? AND company_id = ? FOR UPDATE')
    expect(valores).toEqual(['r1', 'c1'])
    expect(m.txFindMany.mock.invocationCallOrder[0]).toBeGreaterThan(m.queryRaw.mock.invocationCallOrder[0])
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })

  it('round 1: conta já estornada (CREDIT AR:id − DEBIT :estorno = 0) e sem linha ligada: exclui (200)', async () => {
    m.txFindMany.mockResolvedValue([{ bank_ref: 'AR:r1', transaction_type: 'CREDIT', amount: 5000 }, { bank_ref: 'AR:r1:estorno', transaction_type: 'DEBIT', amount: 5000 }])
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
    expect(m.arUpdateMany).toHaveBeenCalledWith({ where: { id: 'r1', company_id: 'c1' }, data: { deleted_at: expect.any(Date) } })
  })

  it('round 1: já estornada mas com linha do banco ligada: 409 com o texto da linha ligada', async () => {
    m.txFindMany.mockResolvedValue([{ bank_ref: 'AR:r1', transaction_type: 'CREDIT', amount: 5000 }, { bank_ref: 'AR:r1:estorno', transaction_type: 'DEBIT', amount: 5000 }])
    m.txFindFirst.mockResolvedValue({ id: 't1' })
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(LIGADA)
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })

  it('round 1: próprio que não se anula E linha ligada: 409 com o texto dos lançamentos próprios', async () => {
    m.txFindMany.mockResolvedValue([{ bank_ref: 'AR:r1', transaction_type: 'CREDIT', amount: 5000 }, { bank_ref: 'AR:r1:estorno', transaction_type: 'DEBIT', amount: 3000 }])
    m.txFindFirst.mockResolvedValue({ id: 't1' })
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PROPRIOS)
  })

  it('round 1: combinação inesperada (DEBIT AR:id) não conta como anulada: 409', async () => {
    m.txFindMany.mockResolvedValue([{ bank_ref: 'AR:r1', transaction_type: 'CREDIT', amount: 5000 }, { bank_ref: 'AR:r1', transaction_type: 'DEBIT', amount: 5000 }])
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PROPRIOS)
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })

  it('round 1: crédito da antecipação (AR:id:anticipation, nunca estornado): 409', async () => {
    m.txFindMany.mockResolvedValue([{ bank_ref: 'AR:r1:anticipation', transaction_type: 'CREDIT', amount: 14000 }])
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(PROPRIOS)
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })

  it('E4: o soft delete roda na mesma tx, depois da trava e das buscas', async () => {
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
    const trava = m.queryRaw.mock.invocationCallOrder[0]
    expect(m.txFindMany.mock.invocationCallOrder[0]).toBeGreaterThan(trava)
    expect(m.txFindFirst.mock.invocationCallOrder[0]).toBeGreaterThan(trava)
    expect(m.arUpdateMany.mock.invocationCallOrder[0]).toBeGreaterThan(m.txFindFirst.mock.invocationCallOrder[0])
  })

  it('AR recebida continua bloqueada pelo guard antigo (409)', async () => {
    m.arFindFirst.mockResolvedValue({ ...AR, status: 'RECEBIDO', received_amount: 15000 })
    const res = await DELETE(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })
})
