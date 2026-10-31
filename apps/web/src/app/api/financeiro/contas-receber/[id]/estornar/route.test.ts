import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = {
    arFindFirst: vi.fn(), arUpdateMany: vi.fn(),
    txFindFirst: vi.fn(), txFindMany: vi.fn(), txCreate: vi.fn(), txUpdate: vi.fn(), txDelete: vi.fn(),
    accUpdate: vi.fn(), catFindFirst: vi.fn(),
  }
  const db = {
    accountReceivable: { findFirst: m.arFindFirst, updateMany: m.arUpdateMany },
    transaction: { findFirst: m.txFindFirst, findMany: m.txFindMany, create: m.txCreate, update: m.txUpdate, delete: m.txDelete },
    account: { update: m.accUpdate },
    category: { findFirst: m.catFindFirst, findMany: async () => [{ id: 'cat:Venda de Servicos', name: 'Venda de Servicos' }] },
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
  m.txFindFirst.mockResolvedValue(null)
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
      [{ amount: 3000, transaction_type: 'CREDIT', bank_ref: 'AR:r1', account_id: 'acc1' }],
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

  it('AR sem lançamento ligado e com crédito próprio AR:id: DEBIT + saldo pelo crédito próprio', async () => {
    transacoes([], [{ amount: 15000, transaction_type: 'CREDIT', bank_ref: 'AR:r1', account_id: 'acc1' }])
    await POST(req(), { params: { id: 'r1' } })
    expect(m.txFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { company_id: 'c1', bank_ref: { in: ['AR:r1', 'AR:r1:estorno'] } },
    }))
    expect(m.txUpdate).not.toHaveBeenCalled()
    expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ account_id: 'acc1', transaction_type: 'DEBIT', amount: 15000, bank_ref: 'AR:r1:estorno' }) })
    expect(m.accUpdate).toHaveBeenCalledWith({ where: { id: 'acc1' }, data: expect.objectContaining({ current_balance: { decrement: 15000 } }) })
  })

  it('F2: Receber ligou → Conferir → Desfazer desligou → Estornar (sem crédito próprio nem linha ligada): só volta o status, nada de DEBIT nem saldo', async () => {
    transacoes([], [])
    const res = await POST(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
    expect(m.arUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDENTE', received_amount: 0 }) }))
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  it('F2: a conta do DEBIT vem do crédito próprio (não de existing.account_id)', async () => {
    transacoes([], [{ amount: 15000, transaction_type: 'CREDIT', bank_ref: 'AR:r1', account_id: 'acc2' }])
    await POST(req(), { params: { id: 'r1' } })
    expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ account_id: 'acc2', amount: 15000 }) })
    expect(m.accUpdate).toHaveBeenCalledWith({ where: { id: 'acc2' }, data: expect.objectContaining({ current_balance: { decrement: 15000 } }) })
    expect(m.accUpdate).toHaveBeenCalledTimes(1)
  })

  it('F2: crédito próprio já estornado antes (CREDIT − DEBIT :estorno = 0): nada de DEBIT nem saldo', async () => {
    transacoes([], [
      { amount: 15000, transaction_type: 'CREDIT', bank_ref: 'AR:r1', account_id: 'acc1' },
      { amount: 15000, transaction_type: 'DEBIT', bank_ref: 'AR:r1:estorno', account_id: 'acc1' },
    ])
    await POST(req(), { params: { id: 'r1' } })
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  it('F2: AR sem account_id mas com crédito próprio numa conta: compensa naquela conta', async () => {
    m.arFindFirst.mockResolvedValue({ ...AR, account_id: null })
    transacoes([], [{ amount: 15000, transaction_type: 'CREDIT', bank_ref: 'AR:r1', account_id: 'acc3' }])
    await POST(req(), { params: { id: 'r1' } })
    expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ account_id: 'acc3', amount: 15000, bank_ref: 'AR:r1:estorno' }) })
    expect(m.accUpdate).toHaveBeenCalledWith({ where: { id: 'acc3' }, data: expect.objectContaining({ current_balance: { decrement: 15000 } }) })
  })

  it('E2: crédito AR:id já LIGADO pelo livro (source_text LIGADA:…) é o dinheiro do banco: não é compensado', async () => {
    transacoes([], [{ amount: 15000, transaction_type: 'CREDIT', bank_ref: 'AR:r1', account_id: 'acc1', source_text: 'LIGADA:itau:2026-10-29:15000' }])
    const res = await POST(req(), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
    expect(m.arUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDENTE', received_amount: 0 }) }))
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.txDelete).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  it('E2: crédito LIGADA + crédito próprio sem banco: compensa só o sem banco', async () => {
    transacoes([], [
      { amount: 12000, transaction_type: 'CREDIT', bank_ref: 'AR:r1', account_id: 'acc1', source_text: 'LIGADA:k1' },
      { amount: 3000, transaction_type: 'CREDIT', bank_ref: 'AR:r1', account_id: 'acc1', source_text: null },
    ])
    await POST(req(), { params: { id: 'r1' } })
    expect(m.txCreate).toHaveBeenCalledTimes(1)
    expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ account_id: 'acc1', transaction_type: 'DEBIT', amount: 3000, bank_ref: 'AR:r1:estorno' }) })
    expect(m.accUpdate).toHaveBeenCalledWith({ where: { id: 'acc1' }, data: expect.objectContaining({ current_balance: { decrement: 3000 } }) })
  })

  it('E9: AR antecipada: 409 "conta antecipada — desfaça a antecipação antes", nada gravado', async () => {
    for (const status of ['RECEBIDO', 'LIQUIDADO', 'PENDENTE']) {
      m.arFindFirst.mockResolvedValue({ ...AR, status, anticipated_at: new Date('2026-10-20T12:00:00Z') })
      transacoes([], [{ amount: 14000, transaction_type: 'CREDIT', bank_ref: 'AR:r1:anticipation', account_id: 'acc1', source_text: null }])
      const res = await POST(req(), { params: { id: 'r1' } })
      expect(res.status).toBe(409)
      expect((await res.json()).error).toBe('conta antecipada — desfaça a antecipação antes')
    }
    expect(m.arUpdateMany).not.toHaveBeenCalled()
    expect(m.txUpdate).not.toHaveBeenCalled()
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  describe('E4: estorno parcial (AR PENDENTE)', () => {
    const PARCIAL = { ...AR, status: 'PENDENTE', received_amount: 5000, total_amount: 15000 }

    it('PENDENTE com recebimento parcial ligado: desliga a linha e zera received_amount', async () => {
      m.arFindFirst.mockResolvedValue(PARCIAL)
      transacoes([{ id: 't1', amount: 5000, source_text: 'PIX PARCIAL', description: 'Recebimento: OS 1 · banco: PIX PARCIAL', category_id: 'cat:Venda de Servicos' }])
      const res = await POST(req(), { params: { id: 'r1' } })
      expect(res.status).toBe(200)
      expect(m.arUpdateMany).toHaveBeenCalledWith({
        where: { id: 'r1', company_id: 'c1', status: { in: ['RECEBIDO', 'LIQUIDADO', 'PAGO', 'PENDENTE'] }, deleted_at: null },
        data: expect.objectContaining({ status: 'PENDENTE', received_amount: 0, reconciled: false }),
      })
      expect(m.txUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { linked_ref: null, category_id: 'cat:Receita a identificar', description: 'PIX PARCIAL' } })
      expect(m.txCreate).not.toHaveBeenCalled()
      expect(m.accUpdate).not.toHaveBeenCalled()
    })

    it('PENDENTE com crédito próprio parcial (AR:id): compensa o crédito próprio', async () => {
      m.arFindFirst.mockResolvedValue(PARCIAL)
      transacoes([], [{ amount: 5000, transaction_type: 'CREDIT', bank_ref: 'AR:r1', account_id: 'acc1', source_text: null }])
      const res = await POST(req(), { params: { id: 'r1' } })
      expect(res.status).toBe(200)
      expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ account_id: 'acc1', transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AR:r1:estorno' }) })
      expect(m.accUpdate).toHaveBeenCalledWith({ where: { id: 'acc1' }, data: expect.objectContaining({ current_balance: { decrement: 5000 } }) })
    })

    it('PENDENTE sem valor recebido mas com lançamento próprio/linha ligada: aceita (o que o ERP criou é desfeito)', async () => {
      m.arFindFirst.mockResolvedValue({ ...PARCIAL, received_amount: 0 })
      m.txFindFirst.mockResolvedValue({ id: 't1' })
      transacoes([{ id: 't1', amount: 5000, source_text: 'PIX', description: 'x', category_id: 'cat:Venda de Servicos' }])
      const res = await POST(req(), { params: { id: 'r1' } })
      expect(res.status).toBe(200)
      expect(m.txFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { company_id: 'c1', OR: [{ bank_ref: { in: ['AR:r1', 'AR:r1:anticipation', 'AR:r1:estorno'] } }, { linked_ref: 'AR:r1' }] },
      }))
      expect(m.txUpdate).toHaveBeenCalledTimes(1)
    })

    it('PENDENTE sem valor recebido e sem lançamento: 400, nada gravado', async () => {
      m.arFindFirst.mockResolvedValue({ ...PARCIAL, received_amount: 0 })
      const res = await POST(req(), { params: { id: 'r1' } })
      expect(res.status).toBe(400)
      expect(m.arUpdateMany).not.toHaveBeenCalled()
      expect(m.txCreate).not.toHaveBeenCalled()
    })

    it('CANCELADO continua recusado (400)', async () => {
      m.arFindFirst.mockResolvedValue({ ...PARCIAL, status: 'CANCELADO' })
      const res = await POST(req(), { params: { id: 'r1' } })
      expect(res.status).toBe(400)
      expect(m.arUpdateMany).not.toHaveBeenCalled()
    })
  })
})
