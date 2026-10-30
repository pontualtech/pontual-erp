import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => { const m = {
  arFindMany: vi.fn(), arUpdate: vi.fn(),
  payFindMany: vi.fn(),
  txFindFirst: vi.fn(), txFindMany: vi.fn(), txCreate: vi.fn(), txUpdate: vi.fn(), txUpdateMany: vi.fn(), txDelete: vi.fn(),
  accUpdate: vi.fn(), catFindFirst: vi.fn(),
}
const db = {
  accountReceivable: { findMany: m.arFindMany, update: m.arUpdate },
  payment: { findMany: m.payFindMany },
  transaction: { findFirst: m.txFindFirst, findMany: m.txFindMany, create: m.txCreate, update: m.txUpdate, updateMany: m.txUpdateMany, delete: m.txDelete },
  account: { update: m.accUpdate },
  category: { findFirst: m.catFindFirst },
  $transaction: async (cb: (tx: unknown) => unknown) => cb(db),
}
return { m, db } })
vi.mock('@pontual/db', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { POST } from './route'

const req = (body: unknown) => new NextRequest('http://x/api/financeiro/contas-receber/bulk-reconcile', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const AR = { id: 'a1', account_id: 'acc1', received_amount: 15000, total_amount: 15000, status: 'RECEBIDO', description: 'OS 1', category_id: null }
const livro = (over: Record<string, unknown> = {}) => ({
  id: 't1', amount: 15000, transaction_type: 'CREDIT', transaction_date: new Date(`${hoje}T00:00:00Z`),
  linked_ref: null, origin: 'BANCO', categories: { name: 'Receita a identificar' }, ...over,
})

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.payFindMany.mockResolvedValue([])
  m.txFindFirst.mockResolvedValue(null)
  m.txUpdateMany.mockResolvedValue({ count: 1 })
  m.catFindFirst.mockImplementation(async ({ where }: any) => ({ id: `cat:${where.name}` }))
})

describe('bulk-reconcile — liga ao lançamento do livro', () => {
  it('(a) AR com lançamento do livro casando: liga, sem criar transação nem mexer no saldo', async () => {
    m.arFindMany.mockResolvedValue([AR])
    m.txFindMany.mockResolvedValue([livro({ source_text: 'PIX CLIENTE' })])
    m.txFindFirst.mockResolvedValueOnce(null) // idempotência
    const res = await POST(req({ ids: ['a1'], reconciled: true }))
    const j = await res.json()
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.txDelete).not.toHaveBeenCalled()
    expect(m.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', company_id: 'c1', linked_ref: null },
      data: expect.objectContaining({ linked_ref: 'AR:a1', category_id: 'cat:Venda de Servicos' }),
    }))
    expect(m.arUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'LIQUIDADO' }) }))
    expect(j.data.ligadas).toBe(1)
    expect(j.data.erros).toEqual([])
  })

  it('(b) sem candidato: cria como hoje, com a categoria Receita de serviços', async () => {
    m.arFindMany.mockResolvedValue([AR])
    m.txFindMany.mockResolvedValue([])
    await POST(req({ ids: ['a1'], reconciled: true }))
    expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ bank_ref: 'AR:a1', category_id: 'cat:Venda de Servicos' }) })
    expect(m.accUpdate).toHaveBeenCalledTimes(1)
    expect(m.txUpdate).not.toHaveBeenCalled()
  })

  it('Conferir sobre linha já categorizada (Venda de Servicos): liga sem criar/creditar e mantém a categoria da linha', async () => {
    m.arFindMany.mockResolvedValue([AR])
    m.txFindMany.mockResolvedValue([livro({ categories: { name: 'Venda de Servicos' } })])
    m.txFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ source_text: 'PIX RECEBIDO FULANO' })
    const res = await POST(req({ ids: ['a1'], reconciled: true }))
    const j = await res.json()
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).toHaveBeenCalledTimes(1)
    const arg = m.txUpdateMany.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 't1', company_id: 'c1', linked_ref: null })
    expect(arg.data).not.toHaveProperty('category_id')
    expect(arg.data).toEqual(expect.objectContaining({ linked_ref: 'AR:a1', description: 'LIQUIDACAO: OS 1 · banco: PIX RECEBIDO FULANO' }))
    expect(j.data.ligadas).toBe(1)
    expect(j.data.balance_delta).toBe(0)
  })

  it('explícito inválido: AR não é baixada e vai em erros', async () => {
    m.arFindMany.mockResolvedValue([AR])
    m.txFindMany.mockResolvedValue([livro({ categories: { name: 'Energia' } })])
    const res = await POST(req({ ids: ['a1'], reconciled: true, livro: { a1: 't1' } }))
    const j = await res.json()
    expect(m.arUpdate).not.toHaveBeenCalled()
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'Lançamento do livro já está categorizado' }])
    expect(j.data.updated).toBe(0)
  })

  it('linha já ligada por outra baixa (count 0): vai em erros e não cria nada', async () => {
    m.arFindMany.mockResolvedValue([AR])
    m.txFindMany.mockResolvedValue([livro()])
    m.txFindFirst.mockResolvedValue(null)
    m.txUpdateMany.mockResolvedValue({ count: 0 })
    const res = await POST(req({ ids: ['a1'], reconciled: true }))
    const j = await res.json()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'lançamento do livro já ligado por outra baixa' }])
    expect(j.data.updated).toBe(0)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  it('(c) desfazer AR ligada: limpa linked_ref, volta categoria, sem delete e sem saldo', async () => {
    m.arFindMany.mockResolvedValue([AR])
    m.txFindFirst.mockResolvedValue(livro({ linked_ref: 'AR:a1', bank_ref: 'linha1', source_text: 'PIX CLIENTE' }))
    await POST(req({ ids: ['a1'], reconciled: false }))
    expect(m.txUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1' },
      data: expect.objectContaining({ linked_ref: null, category_id: 'cat:Receita a identificar', description: 'PIX CLIENTE' }),
    }))
    expect(m.txDelete).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.arUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RECEBIDO' }) }))
  })
})
