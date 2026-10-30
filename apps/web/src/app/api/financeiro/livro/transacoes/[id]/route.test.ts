import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => { const m = {
  txFindFirst: vi.fn(), txUpdate: vi.fn(), txUpdateMany: vi.fn(), txCount: vi.fn(),
  catFindFirst: vi.fn(), catFindMany: vi.fn(),
  ruleFindFirst: vi.fn(), ruleCreate: vi.fn(),
}
const db = {
  transaction: { findFirst: m.txFindFirst, update: m.txUpdate, updateMany: m.txUpdateMany, count: m.txCount },
  category: { findFirst: m.catFindFirst, findMany: m.catFindMany },
  classificationRule: { findFirst: m.ruleFindFirst, create: m.ruleCreate },
  $transaction: async (cb: (tx: unknown) => unknown) => cb(db),
}
return { m, db } })
vi.mock('@pontual/db', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { PATCH } from './route'

const patch = (body: unknown) => PATCH(
  new NextRequest('http://x/api/financeiro/livro/transacoes/t1', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }),
  { params: { id: 't1' } },
)

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.txFindFirst.mockResolvedValue({ id: 't1', category_id: 'fb', source_text: 'PIX ENVIADO ELVIS FERREIRA', description: 'x' })
  m.catFindFirst.mockResolvedValue({ id: 'cat1' })
  m.catFindMany.mockResolvedValue([{ id: 'fb1' }, { id: 'fb2' }])
  m.ruleFindFirst.mockResolvedValue(null)
  m.txUpdateMany.mockResolvedValue({ count: 3 })
  m.txCount.mockResolvedValue(3)
})

describe('PATCH livro/transacoes/[id] — regra derivada + retroativo', () => {
  it('deriva o padrão, cria a regra e recategoriza só fallback/BANCO/mesmo tipo', async () => {
    const res = await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })
    const j = (await res.json()).data
    expect(m.ruleCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ pattern: 'ELVIS FERREIRA', direction: 'OUT' }) })
    expect(m.txUpdateMany).toHaveBeenCalledWith({
      where: {
        company_id: 'c1', origin: 'BANCO', id: { not: 't1' },
        category_id: { in: ['fb1', 'fb2'] },
        source_text: { contains: 'ELVIS FERREIRA', mode: 'insensitive' },
        transaction_type: 'DEBIT',
      },
      data: { category_id: 'cat1' },
    })
    expect(j.regra).toEqual({ pattern: 'ELVIS FERREIRA', direction: 'OUT' })
    expect(j.regra_criada).toBe(true)
    expect(j.recategorizadas).toBe(3)
  })

  it('direção null não filtra por tipo', async () => {
    await patch({ category_id: 'cat1', criar_regra: { pattern: 'abc loja', direction: null } })
    const where = m.txUpdateMany.mock.calls[0][0].where
    expect(where).not.toHaveProperty('transaction_type')
    expect(where.source_text.contains).toBe('abc loja')
  })

  it('regra já existente: não cria, mas ainda recategoriza', async () => {
    m.ruleFindFirst.mockResolvedValue({ id: 'r1' })
    const j = (await (await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })).json()).data
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).toHaveBeenCalled()
    expect(j.regra_criada).toBe(false)
    expect(j.regra).toEqual({ pattern: 'ELVIS FERREIRA', direction: 'OUT' })
  })

  it('simular: não grava nada e informa a contagem', async () => {
    const j = (await (await patch({ category_id: 'cat1', simular: true, criar_regra: { direction: 'OUT' } })).json()).data
    expect(m.txUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).not.toHaveBeenCalled()
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(j.simulado).toBe(true)
    expect(j.recategorizadas).toBe(3)
  })

  it('pattern null: não cria regra nem recategoriza outras', async () => {
    const j = (await (await patch({ category_id: 'cat1', criar_regra: { pattern: null, direction: 'OUT' } })).json()).data
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).not.toHaveBeenCalled()
    expect(j.regra).toBeNull()
    expect(j.motivo_sem_regra).toBeTruthy()
    expect(j.recategorizadas).toBe(0)
  })

  it('texto genérico sem padrão seguro: regra null com motivo', async () => {
    m.txFindFirst.mockResolvedValue({ id: 't1', category_id: 'fb', source_text: 'PIX ENVIADO', description: 'x' })
    const j = (await (await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })).json()).data
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(j.regra).toBeNull()
    expect(j.motivo_sem_regra).toMatch(/genérico/)
  })

  it('nota: description = source_text + " — " + nota', async () => {
    await patch({ category_id: 'cat1', nota: 'aluguel' })
    expect(m.txUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { category_id: 'cat1', description: 'PIX ENVIADO ELVIS FERREIRA — aluguel' },
    })
  })
})
