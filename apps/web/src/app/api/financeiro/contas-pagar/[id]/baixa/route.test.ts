import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = {
    apFindFirst: vi.fn(), apUpdateMany: vi.fn(), apFindFirstOrThrow: vi.fn(),
    accFindFirst: vi.fn(), accUpdate: vi.fn(),
    txFindFirst: vi.fn(), txFindMany: vi.fn(), txCreate: vi.fn(), txUpdate: vi.fn(), txUpdateMany: vi.fn(),
    catFindFirst: vi.fn(),
  }
  const db = {
    accountPayable: { findFirst: m.apFindFirst, updateMany: m.apUpdateMany, findFirstOrThrow: m.apFindFirstOrThrow },
    account: { findFirst: m.accFindFirst, update: m.accUpdate },
    transaction: { findFirst: m.txFindFirst, findMany: m.txFindMany, create: m.txCreate, update: m.txUpdate, updateMany: m.txUpdateMany },
    category: { findFirst: m.catFindFirst },
    $transaction: async (cb: (tx: unknown) => unknown) => cb(db),
  }
  return { m, db }
})
vi.mock('@pontual/db', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { POST } from './route'

const ACC = '11111111-1111-4111-8111-111111111111'
const AP = { id: 'p1', status: 'PENDENTE', total_amount: 5000, paid_amount: 0, description: 'Luz', category_id: 'catEnergia', payment_method: null }
const req = (body: unknown) => new NextRequest('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const livro = (over: Record<string, unknown> = {}) => ({
  id: 't1', amount: 5000, transaction_type: 'DEBIT', transaction_date: new Date('2026-10-28T00:00:00Z'),
  linked_ref: null, origin: 'BANCO', categories: { name: 'A classificar' }, ...over,
})

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.apFindFirst.mockResolvedValue(AP)
  m.apFindFirstOrThrow.mockResolvedValue({ ...AP, status: 'PAGO' })
  m.apUpdateMany.mockResolvedValue({ count: 1 })
  m.accFindFirst.mockResolvedValue({ id: ACC, is_active: true })
  m.txUpdateMany.mockResolvedValue({ count: 1 })
  m.catFindFirst.mockResolvedValue({ name: 'Energia' })
})

describe('baixa de AP — livro-razão', () => {
  it('liga ao lançamento do banco: sem transaction.create e sem account.update', async () => {
    m.txFindMany.mockResolvedValue([livro()])
    m.txFindFirst.mockResolvedValue({ source_text: 'PGTO ENEL' })
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    const j = await res.json()
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', company_id: 'c1', linked_ref: null },
      data: expect.objectContaining({ linked_ref: 'AP:p1', category_id: 'catEnergia', description: 'Pgto: Luz · banco: PGTO ENEL' }),
    }))
    expect(j.data.ligada).toBe(true)
  })

  it('linha já categorizada por regra (Energia): liga sem criar/debitar e mantém a categoria da linha', async () => {
    m.txFindMany.mockResolvedValue([livro({ categories: { name: 'Energia' } })])
    m.txFindFirst.mockResolvedValue({ source_text: 'ELETROPAULO' })
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    const j = await res.json()
    expect(res.status).toBe(200)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).toHaveBeenCalledTimes(1)
    const arg = m.txUpdateMany.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 't1', company_id: 'c1', linked_ref: null })
    expect(arg.data).toEqual({ linked_ref: 'AP:p1', description: 'Pgto: Luz · banco: ELETROPAULO', reconciled: true })
    expect(j.data.ligada).toBe(true)
  })

  it('linha de ajuste de caixa não serve: cria e debita', async () => {
    m.txFindMany.mockResolvedValue([livro({ categories: { name: 'Ajuste de caixa' } })])
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    expect((await res.json()).data.ligada).toBe(false)
    expect(m.txUpdateMany).not.toHaveBeenCalled()
    expect(m.txCreate).toHaveBeenCalledTimes(1)
    expect(m.accUpdate).toHaveBeenCalledTimes(1)
  })

  it('linha já ligada por outra baixa (count 0): 409, sem criar nem debitar', async () => {
    m.txFindMany.mockResolvedValue([livro()])
    m.txFindFirst.mockResolvedValue({ source_text: 'PGTO ENEL' })
    m.txUpdateMany.mockResolvedValue({ count: 0 })
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    expect(res.status).toBe(409)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  it('E3: janela do Pagar = 10 dias antes / 3 depois da data real; linha de 20 dias antes não é ligada (cria)', async () => {
    m.txFindMany.mockResolvedValue([livro({ transaction_date: new Date('2026-10-09T00:00:00Z') })])
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    expect(m.txFindMany.mock.calls[0][0].where.OR[0]).toEqual({
      transaction_date: { gte: new Date('2026-10-19T00:00:00Z'), lte: new Date('2026-11-01T00:00:00Z') },
    })
    expect((await res.json()).data.ligada).toBe(false)
    expect(m.txUpdateMany).not.toHaveBeenCalled()
    expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ bank_ref: 'AP:p1', amount: 5000 }) })
  })

  it('E5: AP sem account_id ganha a conta da baixa; AP com conta mantém a sua', async () => {
    m.txFindMany.mockResolvedValue([])
    await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    expect(m.apUpdateMany.mock.calls[0][0].data).toEqual(expect.objectContaining({ account_id: ACC }))
    m.apUpdateMany.mockClear()
    m.apFindFirst.mockResolvedValue({ ...AP, account_id: 'outra' })
    await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    expect(m.apUpdateMany.mock.calls[0][0].data).not.toHaveProperty('account_id')
  })

  it('sem candidato: cria e debita como hoje', async () => {
    m.txFindMany.mockResolvedValue([])
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, paid_at: '2026-10-29' }), { params: { id: 'p1' } })
    expect((await res.json()).data.ligada).toBe(false)
    expect(m.txCreate).toHaveBeenCalledTimes(1)
    expect(m.accUpdate).toHaveBeenCalledTimes(1)
  })

  it('livro_transaction_id inválido (linha de categoria alheia): 422 e nada escrito', async () => {
    m.txFindMany.mockResolvedValue([livro({ categories: { name: 'Anúncios' } })])
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, livro_transaction_id: 't1' }), { params: { id: 'p1' } })
    expect(res.status).toBe(422)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.txUpdate).not.toHaveBeenCalled()
  })

  describe('F6: vínculo explícito com diferença ≤ R$ 1 quita a AP por inteiro', () => {
    const AP10 = { ...AP, total_amount: 10000, notes: null }
    const baixa = (paid_amount: number, extra: Record<string, unknown> = { livro_transaction_id: 't1' }) =>
      POST(req({ paid_amount, account_id: ACC, ...extra }), { params: { id: 'p1' } })

    beforeEach(() => {
      m.apFindFirst.mockResolvedValue(AP10)
      m.txFindFirst.mockResolvedValue({ source_text: 'PGTO ENEL' })
    })

    it('AP 10000, linha 9950 → PAGO (paid 10000), ligada, nota com 0,50', async () => {
      m.txFindMany.mockResolvedValue([livro({ amount: 9950 })])
      const res = await baixa(9950)
      expect(res.status).toBe(200)
      expect((await res.json()).data.ligada).toBe(true)
      const data = m.apUpdateMany.mock.calls[0][0].data
      expect(data).toEqual(expect.objectContaining({ paid_amount: 10000, status: 'PAGO' }))
      expect(data.notes).toBe('diferença bancária de R$ 0,50')
      expect(m.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't1', company_id: 'c1', linked_ref: null } }))
      expect(m.txCreate).not.toHaveBeenCalled()
      expect(m.accUpdate).not.toHaveBeenCalled()
    })

    it('AP 10000, linha 10050 (excede o restante em 0,50) → PAGO (paid 10000), ligada; nota anexada às notes existentes', async () => {
      m.apFindFirst.mockResolvedValue({ ...AP10, notes: 'boleto ENEL' })
      m.txFindMany.mockResolvedValue([livro({ amount: 10050 })])
      const res = await baixa(10050)
      expect(res.status).toBe(200)
      expect((await res.json()).data.ligada).toBe(true)
      const data = m.apUpdateMany.mock.calls[0][0].data
      expect(data).toEqual(expect.objectContaining({ paid_amount: 10000, status: 'PAGO', notes: 'boleto ENEL — diferença bancária de R$ 0,50' }))
      expect(m.txCreate).not.toHaveBeenCalled()
      expect(m.accUpdate).not.toHaveBeenCalled()
    })

    it('linha igual ao restante: PAGO sem nota', async () => {
      m.txFindMany.mockResolvedValue([livro({ amount: 10000 })])
      await baixa(10000)
      const data = m.apUpdateMany.mock.calls[0][0].data
      expect(data).toEqual(expect.objectContaining({ paid_amount: 10000, status: 'PAGO' }))
      expect(data).not.toHaveProperty('notes')
    })

    it('AP parcialmente paga (3000 de 10000), linha 6990 do restante 7000 → PAGO (paid 10000)', async () => {
      m.apFindFirst.mockResolvedValue({ ...AP10, paid_amount: 3000 })
      m.txFindMany.mockResolvedValue([livro({ amount: 6990 })])
      await baixa(6990)
      expect(m.apUpdateMany.mock.calls[0][0].data).toEqual(expect.objectContaining({ paid_amount: 10000, status: 'PAGO', notes: 'diferença bancária de R$ 0,10' }))
    })

    it('sem livro_transaction_id, 10050 continua excedendo o restante: 400 sem escrever', async () => {
      m.txFindMany.mockResolvedValue([livro({ amount: 10050 })])
      const res = await baixa(10050, {})
      expect(res.status).toBe(400)
      expect(m.apUpdateMany).not.toHaveBeenCalled()
    })

    it('com livro_transaction_id, valor acima do restante + R$ 1: 400 sem escrever', async () => {
      m.txFindMany.mockResolvedValue([livro({ amount: 10101 })])
      const res = await baixa(10101)
      expect(res.status).toBe(400)
      expect(m.apUpdateMany).not.toHaveBeenCalled()
    })

    it('tolerância da pré-checagem não vira 500: valor 10080 com linha 10150 (fora de R$ 1 do restante) → 400 sem escrever', async () => {
      m.txFindMany.mockResolvedValue([livro({ amount: 10150 })])
      const res = await baixa(10080)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/excede o saldo restante/)
      expect(m.apUpdateMany).not.toHaveBeenCalled()
      expect(m.txUpdateMany).not.toHaveBeenCalled()
      expect(m.txCreate).not.toHaveBeenCalled()
    })

    it('linha explícita de pagamento parcial (5000 de 10000): baixa parcial como hoje (PENDENTE, paid 5000, sem nota)', async () => {
      m.apFindFirstOrThrow.mockResolvedValue({ ...AP10, status: 'PENDENTE' })
      m.txFindMany.mockResolvedValue([livro({ amount: 5000 })])
      await baixa(5000)
      const data = m.apUpdateMany.mock.calls[0][0].data
      expect(data).toEqual(expect.objectContaining({ paid_amount: 5000, status: 'PENDENTE' }))
      expect(data).not.toHaveProperty('notes')
    })
  })

  it('F5: livro_transaction_id em linha da mesma categoria da AP (Energia): liga, sem criar nem debitar', async () => {
    m.txFindMany.mockResolvedValue([livro({ categories: { name: 'Energia' } })])
    m.txFindFirst.mockResolvedValue({ source_text: 'ELETROPAULO' })
    const res = await POST(req({ paid_amount: 5000, account_id: ACC, livro_transaction_id: 't1' }), { params: { id: 'p1' } })
    expect(res.status).toBe(200)
    expect((await res.json()).data.ligada).toBe(true)
    expect(m.txUpdateMany.mock.calls[0][0].data).not.toHaveProperty('category_id')
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })
})
