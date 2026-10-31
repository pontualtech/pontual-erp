import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => { const m = {
  arFindMany: vi.fn(), arFindFirst: vi.fn(), arUpdate: vi.fn(), arUpdateMany: vi.fn(),
  payFindMany: vi.fn(), queryRaw: vi.fn(),
  txFindFirst: vi.fn(), txFindMany: vi.fn(), txCreate: vi.fn(), txUpdate: vi.fn(), txUpdateMany: vi.fn(), txDelete: vi.fn(),
  accUpdate: vi.fn(), catFindFirst: vi.fn(),
}
const db = {
  accountReceivable: { findMany: m.arFindMany, findFirst: m.arFindFirst, update: m.arUpdate, updateMany: m.arUpdateMany },
  payment: { findMany: m.payFindMany },
  transaction: { findFirst: m.txFindFirst, findMany: m.txFindMany, create: m.txCreate, update: m.txUpdate, updateMany: m.txUpdateMany, delete: m.txDelete },
  account: { update: m.accUpdate },
  category: { findFirst: m.catFindFirst, findMany: async () => [{ id: 'cat:Venda de Servicos', name: 'Venda de Servicos' }] },
  $queryRaw: m.queryRaw,
  $transaction: async (cb: (tx: unknown) => unknown) => cb(db),
}
return { m, db } })
vi.mock('@pontual/db', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/financeiro/livro-baixa-db', async (importOriginal) => {
  const o = await importOriginal<typeof import('@/lib/financeiro/livro-baixa-db')>()
  return { ...o, hojeSP: vi.fn(o.hojeSP) }
})

import { POST } from './route'
import { hojeSP } from '@/lib/financeiro/livro-baixa-db'

const req = (body: unknown) => new NextRequest('http://x/api/financeiro/contas-receber/bulk-reconcile', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const AR = { id: 'a1', account_id: 'acc1', received_amount: 15000, total_amount: 15000, status: 'RECEBIDO', description: 'OS 1', category_id: null }
const livro = (over: Record<string, unknown> = {}) => ({
  id: 't1', amount: 15000, transaction_type: 'CREDIT', transaction_date: new Date(`${hoje}T00:00:00Z`),
  linked_ref: null, origin: 'BANCO', categories: { name: 'Receita a identificar' }, ...over,
})

// A lista de fora (findMany) só dá os ids; a AR que decide é a relida dentro da tx (findFirst), depois da trava.
const comAR = (...lista: Record<string, unknown>[]) => {
  m.arFindMany.mockResolvedValue(lista)
  m.arFindFirst.mockImplementation(async ({ where }: any) => lista.find((a) => a.id === where.id) ?? null)
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.queryRaw.mockImplementation(async (_sql: unknown, id: string) => [{ id }])
  vi.mocked(hojeSP).mockReset() // volta à implementação real (descarta mockReturnValueOnce pendente)
  m.payFindMany.mockResolvedValue([])
  m.txFindFirst.mockResolvedValue(null)
  m.txUpdateMany.mockResolvedValue({ count: 1 })
  m.arUpdateMany.mockResolvedValue({ count: 1 })
  m.catFindFirst.mockImplementation(async ({ where }: any) => ({ id: `cat:${where.name}` }))
})

describe('bulk-reconcile — liga ao lançamento do livro', () => {
  it('(a) AR com lançamento do livro casando: liga, sem criar transação nem mexer no saldo', async () => {
    comAR(AR)
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
    expect(m.arUpdate).toHaveBeenCalledWith({
      where: { id: 'a1', company_id: 'c1' },
      data: expect.objectContaining({ reconciled: true, status: 'LIQUIDADO' }),
    })
    expect(m.arUpdateMany).not.toHaveBeenCalled()
    expect(j.data.ligadas).toBe(1)
    expect(j.data.erros).toEqual([])
  })

  describe('E1: AR travada (FOR UPDATE) e relida dentro da tx', () => {
    // Simula outra requisição que comitou enquanto esta esperava a trava: só aparece depois do SELECT … FOR UPDATE.
    const depoisDaTrava = (valor: unknown) => async () => (m.queryRaw.mock.calls.length > 0 ? valor : null)

    it('trava a linha da AR antes de reler a AR, os pagamentos e o lançamento', async () => {
      comAR(AR)
      m.txFindMany.mockResolvedValue([])
      await POST(req({ ids: ['a1'], reconciled: true }))
      expect(m.queryRaw).toHaveBeenCalledTimes(1)
      const [sql, ...valores] = m.queryRaw.mock.calls[0]
      expect((sql as string[]).join('?')).toBe('SELECT id FROM accounts_receivable WHERE id = ? AND company_id = ? FOR UPDATE')
      expect(valores).toEqual(['a1', 'c1'])
      const trava = m.queryRaw.mock.invocationCallOrder[0]
      expect(m.arFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a1', company_id: 'c1', deleted_at: null } }))
      expect(m.arFindFirst.mock.invocationCallOrder[0]).toBeGreaterThan(trava)
      expect(m.payFindMany.mock.invocationCallOrder[0]).toBeGreaterThan(trava)
      expect(m.txFindFirst.mock.invocationCallOrder[0]).toBeGreaterThan(trava)
    })

    it('Receber comitado enquanto esperava a trava: o crédito aparece na releitura → só LIQUIDADO, nada criado nem ligado', async () => {
      comAR(AR)
      m.txFindMany.mockResolvedValue([livro()])
      m.txFindFirst.mockImplementation(depoisDaTrava({ id: 'x1', bank_ref: 'AR:a1', linked_ref: null }))
      const j = await (await POST(req({ ids: ['a1'], reconciled: true }))).json()
      expect(m.txCreate).not.toHaveBeenCalled()
      expect(m.accUpdate).not.toHaveBeenCalled()
      expect(m.txUpdateMany).not.toHaveBeenCalled()
      expect(m.arUpdate).toHaveBeenCalledWith({ where: { id: 'a1', company_id: 'c1' }, data: expect.objectContaining({ reconciled: true, status: 'LIQUIDADO' }) })
      expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 0, balance_delta: 0, erros: [] }))
    })

    it('PENDENTE (a lista de fora dizia RECEBIDO; a releitura diz PENDENTE): erro "conta não recebida", nada gravado', async () => {
      m.arFindMany.mockResolvedValue([AR])
      m.arFindFirst.mockResolvedValue({ ...AR, status: 'PENDENTE' })
      m.txFindMany.mockResolvedValue([livro()])
      for (const corpo of [{}, { livro: { a1: 't1' } }]) {
        const j = await (await POST(req({ ids: ['a1'], reconciled: true, ...corpo }))).json()
        expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta não recebida' }])
        expect(j.data.updated).toBe(0)
      }
      expect(m.arUpdate).not.toHaveBeenCalled()
      expect(m.arUpdateMany).not.toHaveBeenCalled()
      expect(m.txCreate).not.toHaveBeenCalled()
      expect(m.txUpdateMany).not.toHaveBeenCalled()
      expect(m.accUpdate).not.toHaveBeenCalled()
    })

    it('PENDENTE sem conta bancária também não vira LIQUIDADO', async () => {
      comAR({ ...AR, status: 'PENDENTE', account_id: null })
      const j = await (await POST(req({ ids: ['a1'], reconciled: true }))).json()
      expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta não recebida' }])
      expect(m.arUpdate).not.toHaveBeenCalled()
    })

    it('webhook Inter marcou reconciled=true sem lançar crédito: Conferir cria o crédito (não "já conciliada")', async () => {
      comAR({ ...AR, reconciled: true })
      m.arUpdateMany.mockResolvedValue({ count: 0 }) // o guard antigo (reconciled false|null) não pegaria esta linha
      m.txFindMany.mockResolvedValue([])
      const j = await (await POST(req({ ids: ['a1'], reconciled: true }))).json()
      expect(j.data.erros).toEqual([])
      expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ account_id: 'acc1', transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' }) })
      expect(m.accUpdate).toHaveBeenCalledWith({ where: { id: 'acc1' }, data: expect.objectContaining({ current_balance: { increment: 15000 } }) })
      expect(m.arUpdate).toHaveBeenCalledWith({ where: { id: 'a1', company_id: 'c1' }, data: expect.objectContaining({ reconciled: true, status: 'LIQUIDADO' }) })
      expect(j.data.balance_delta).toBe(15000)
    })

    it('a conta bancária que vale é a relida (PATCH comitado antes): cria o crédito nela', async () => {
      m.arFindMany.mockResolvedValue([{ ...AR, account_id: null }])
      m.arFindFirst.mockResolvedValue({ ...AR, account_id: 'acc7' })
      m.txFindMany.mockResolvedValue([])
      await POST(req({ ids: ['a1'], reconciled: true }))
      expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ account_id: 'acc7', bank_ref: 'AR:a1' }) })
      expect(m.accUpdate).toHaveBeenCalledWith({ where: { id: 'acc7' }, data: expect.anything() })
    })

    it('AR excluída enquanto esperava a trava: vai em erros, nada gravado', async () => {
      m.arFindMany.mockResolvedValue([AR])
      m.arFindFirst.mockResolvedValue(null)
      for (const reconciled of [true, false]) {
        const j = await (await POST(req({ ids: ['a1'], reconciled }))).json()
        expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta a receber não encontrada' }])
        expect(j.data.updated).toBe(0)
      }
      expect(m.arUpdate).not.toHaveBeenCalled()
      expect(m.txCreate).not.toHaveBeenCalled()
      expect(m.txDelete).not.toHaveBeenCalled()
    })

    it('Desfazer concorrente com Conferir: o crédito do Conferir aparece na releitura → apaga e debita', async () => {
      comAR({ ...AR, status: 'LIQUIDADO', reconciled: true })
      m.txFindFirst.mockImplementation(depoisDaTrava({ id: 'x1', bank_ref: 'AR:a1', linked_ref: null, account_id: 'acc1', amount: 15000 }))
      const j = await (await POST(req({ ids: ['a1'], reconciled: false }))).json()
      expect(m.queryRaw).toHaveBeenCalledTimes(1)
      expect(m.txDelete).toHaveBeenCalledWith({ where: { id: 'x1' } })
      expect(m.accUpdate).toHaveBeenCalledWith({ where: { id: 'acc1' }, data: expect.objectContaining({ current_balance: { decrement: 15000 } }) })
      expect(m.arUpdate).toHaveBeenCalledWith({ where: { id: 'a1', company_id: 'c1' }, data: expect.objectContaining({ reconciled: false, status: 'RECEBIDO' }) })
      expect(j.data.balance_delta).toBe(-15000)
    })
  })

  it('F11: livro explícito e AR sem conta bancária: vai em erros, NÃO liquida', async () => {
    comAR({ ...AR, account_id: null })
    const j = await (await POST(req({ ids: ['a1'], reconciled: true, livro: { a1: 't1' } }))).json()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta a receber sem conta bancária; vínculo não feito' }])
    expect(j.data.updated).toBe(0)
    expect(m.arUpdate).not.toHaveBeenCalled()
    expect(m.arUpdateMany).not.toHaveBeenCalled()
    expect(m.txUpdateMany).not.toHaveBeenCalled()
  })

  it('F11: livro explícito e AR sem valor: vai em erros (antes: pulava em silêncio)', async () => {
    comAR({ ...AR, received_amount: 0, total_amount: 0 })
    const j = await (await POST(req({ ids: ['a1'], reconciled: true, livro: { a1: 't1' } }))).json()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta a receber sem valor; vínculo não feito' }])
    expect(j.data.updated).toBe(0)
    expect(m.arUpdate).not.toHaveBeenCalled()
    expect(m.arUpdateMany).not.toHaveBeenCalled()
  })

  it('sem livro explícito, AR sem conta bancária continua só virando LIQUIDADO', async () => {
    comAR({ ...AR, account_id: null })
    const j = await (await POST(req({ ids: ['a1'], reconciled: true }))).json()
    expect(j.data.erros).toEqual([])
    expect(j.data.updated).toBe(1)
    expect(m.arUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'LIQUIDADO' }) }))
    expect(m.txCreate).not.toHaveBeenCalled()
  })

  it('F3: Conferir 20 dias depois do crédito do banco liga (janela 30 antes / 3 depois), sem criar nem creditar', async () => {
    const DIA = 86_400_000
    const base = Date.parse(`${hoje}T00:00:00Z`)
    comAR(AR)
    m.txFindMany.mockResolvedValue([livro({ transaction_date: new Date(base - 20 * DIA) })])
    const j = await (await POST(req({ ids: ['a1'], reconciled: true }))).json()
    expect(m.txFindMany.mock.calls[0][0].where.OR[0]).toEqual({
      transaction_date: { gte: new Date(base - 30 * DIA), lte: new Date(base + 3 * DIA) },
    })
    expect(j.data.ligadas).toBe(1)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
  })

  it('E3: Conferir com vínculo explícito busca a linha pedida por id e a janela do Receber (10/3)', async () => {
    const DIA = 86_400_000
    const base = Date.parse(`${hoje}T00:00:00Z`)
    comAR(AR)
    m.txFindMany.mockResolvedValue([livro()])
    const j = await (await POST(req({ ids: ['a1'], reconciled: true, livro: { a1: 't1' } }))).json()
    expect(m.txFindMany.mock.calls[0][0].where.OR).toEqual([
      { transaction_date: { gte: new Date(base - 10 * DIA), lte: new Date(base + 3 * DIA) } },
      { id: 't1' },
    ])
    expect(j.data.ligadas).toBe(1)
  })

  it('E11: hojeSP uma vez por AR — virada da meia-noite entre a busca e a decisão não muda a janela', async () => {
    vi.mocked(hojeSP).mockReturnValueOnce('2026-10-30').mockReturnValueOnce('2026-10-31')
    comAR(AR)
    // 30 dias antes de 30/10 (dentro); seria 31 antes de 31/10 (fora) se a decisão relesse a data.
    m.txFindMany.mockResolvedValue([livro({ transaction_date: new Date('2026-09-30T00:00:00Z') })])
    const j = await (await POST(req({ ids: ['a1'], reconciled: true }))).json()
    expect(m.txFindMany.mock.calls[0][0].where.OR[0].transaction_date.gte).toEqual(new Date('2026-09-30T00:00:00Z'))
    expect(j.data.ligadas).toBe(1)
    expect(m.txCreate).not.toHaveBeenCalled()
  })

  it('(b) sem candidato: cria como hoje, com a categoria Receita de serviços', async () => {
    comAR(AR)
    m.txFindMany.mockResolvedValue([])
    await POST(req({ ids: ['a1'], reconciled: true }))
    expect(m.txCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ bank_ref: 'AR:a1', category_id: 'cat:Venda de Servicos' }) })
    expect(m.accUpdate).toHaveBeenCalledTimes(1)
    expect(m.txUpdate).not.toHaveBeenCalled()
  })

  it('Conferir sobre linha já categorizada (Venda de Servicos): liga sem criar/creditar e mantém a categoria da linha', async () => {
    comAR(AR)
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

  it('livro explícito e a AR já tem outro lançamento: vai em erros, sem baixar nem ligar', async () => {
    comAR(AR)
    m.txFindFirst.mockResolvedValue({ id: 'x9', bank_ref: 'AR:a1', linked_ref: null })
    const res = await POST(req({ ids: ['a1'], reconciled: true, livro: { a1: 't1' } }))
    const j = await res.json()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta a receber já tem lançamento; vínculo não feito' }])
    expect(j.data.updated).toBe(0)
    expect(m.arUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).not.toHaveBeenCalled()
    expect(m.txCreate).not.toHaveBeenCalled()
  })

  it('livro explícito já ligado a esta AR: idempotente (LIQUIDADO, sem erro, ligadas 1)', async () => {
    comAR(AR)
    m.txFindFirst.mockResolvedValue({ id: 't1', bank_ref: 'linha1', linked_ref: 'AR:a1' })
    const j = await (await POST(req({ ids: ['a1'], reconciled: true, livro: { a1: 't1' } }))).json()
    expect(j.data.erros).toEqual([])
    expect(j.data.updated).toBe(1)
    expect(j.data.ligadas).toBe(1)
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).not.toHaveBeenCalled()
    expect(m.arUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'LIQUIDADO' }) }))
  })

  it('corpo `livro` inválido: 422 sem processar nada', async () => {
    for (const livroInvalido of [{ a1: 123 }, 'x', ['t1']]) {
      m.arFindMany.mockClear()
      const res = await POST(req({ ids: ['a1'], reconciled: true, livro: livroInvalido }))
      expect(res.status).toBe(422)
      expect(m.arFindMany).not.toHaveBeenCalled()
    }
  })

  it('explícito inválido: AR não é baixada e vai em erros', async () => {
    comAR(AR)
    m.txFindMany.mockResolvedValue([livro({ categories: { name: 'Energia' } })])
    const res = await POST(req({ ids: ['a1'], reconciled: true, livro: { a1: 't1' } }))
    const j = await res.json()
    expect(m.arUpdate).not.toHaveBeenCalled()
    expect(m.arUpdateMany).not.toHaveBeenCalled()
    expect(m.txCreate).not.toHaveBeenCalled()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'Lançamento do livro já está categorizado' }])
    expect(j.data.updated).toBe(0)
  })

  it('linha já ligada por outra baixa (count 0): vai em erros e não cria nada', async () => {
    comAR(AR)
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
    comAR(AR)
    m.txFindFirst.mockResolvedValue(livro({ linked_ref: 'AR:a1', bank_ref: 'linha1', source_text: 'PIX CLIENTE', category_id: 'cat:Venda de Servicos' }))
    await POST(req({ ids: ['a1'], reconciled: false }))
    expect(m.txUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1' },
      data: expect.objectContaining({ linked_ref: null, category_id: 'cat:Receita a identificar', description: 'PIX CLIENTE' }),
    }))
    expect(m.txDelete).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.arUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RECEBIDO' }) }))
  })

  it('E2: desfazer com crédito AR:id já LIGADO pelo livro (dinheiro do banco): não apaga nem debita, só volta o status', async () => {
    comAR({ ...AR, status: 'LIQUIDADO', reconciled: true })
    m.txFindFirst.mockResolvedValue({ id: 'x1', bank_ref: 'AR:a1', linked_ref: null, source_text: 'LIGADA:itau:k1', account_id: 'acc1', amount: 15000 })
    const j = await (await POST(req({ ids: ['a1'], reconciled: false }))).json()
    expect(m.txDelete).not.toHaveBeenCalled()
    expect(m.accUpdate).not.toHaveBeenCalled()
    expect(m.txUpdate).not.toHaveBeenCalled()
    expect(m.arUpdate).toHaveBeenCalledWith({ where: { id: 'a1', company_id: 'c1' }, data: expect.objectContaining({ reconciled: false, status: 'RECEBIDO' }) })
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, balance_delta: 0, erros: [] }))
  })

  it('desfazer AR ligada a linha que já tinha outra categoria: mantém a categoria da linha', async () => {
    comAR(AR)
    m.txFindFirst.mockResolvedValue(livro({ linked_ref: 'AR:a1', bank_ref: 'linha1', source_text: 'REND PAGO APLIC', category_id: 'cat:Rendimentos' }))
    await POST(req({ ids: ['a1'], reconciled: false }))
    expect(m.txUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { linked_ref: null, category_id: 'cat:Rendimentos', description: 'REND PAGO APLIC' },
    })
    expect(m.accUpdate).not.toHaveBeenCalled()
  })
})
