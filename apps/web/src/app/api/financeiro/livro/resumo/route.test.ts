import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => {
  const m = { accFindMany: vi.fn(), accFindFirst: vi.fn(), txFindMany: vi.fn() }
  const db = {
    account: { findMany: m.accFindMany, findFirst: m.accFindFirst },
    transaction: { findMany: m.txFindMany },
  }
  return { m, db }
})
vi.mock('@pontual/db', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))

import { GET } from './route'

const get = (qs = '') => GET(new NextRequest(`http://x/api/financeiro/livro/resumo${qs}`))
const TZ_ORIGINAL = process.env.TZ
// Atribuir undefined grava a string "undefined"; sem TZ original, remove a variável.
const restaurarTZ = (original: string | undefined) => {
  if (original === undefined) delete process.env.TZ
  else process.env.TZ = original
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.accFindMany.mockResolvedValue([{ id: 'acc1', name: 'Itaú' }])
  m.accFindFirst.mockResolvedValue(null)
  m.txFindMany.mockResolvedValue([])
})
afterEach(() => {
  vi.useRealTimers()
  restaurarTZ(TZ_ORIGINAL)
})

describe('GET livro/resumo (F15)', () => {
  it('conta da empresa sem linha BANCO: 200 com resumo vazio', async () => {
    m.accFindFirst.mockResolvedValue({ id: 'acc9' })
    const res = await get('?from=2026-10-01&to=2026-10-31&account_id=acc9')
    expect(res.status).toBe(200)
    const j = (await res.json()).data
    expect(m.accFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'acc9', company_id: 'c1' } }))
    expect(j).toEqual(expect.objectContaining({
      contas: [], entradas: [], saidas: [], total_entradas: 0, total_saidas: 0, fora_do_total: [],
    }))
  })

  it('conta que não é da empresa: 400', async () => {
    const res = await get('?from=2026-10-01&to=2026-10-31&account_id=outra')
    expect(res.status).toBe(400)
    expect(m.txFindMany).not.toHaveBeenCalled()
  })

  it('data inexistente (2026-02-31) é rejeitada: 400', async () => {
    expect((await get('?from=2026-02-01&to=2026-02-31')).status).toBe(400)
    expect((await get('?from=2026-13-01&to=2026-13-02')).status).toBe(400)
    expect(m.txFindMany).not.toHaveBeenCalled()
  })

  it('mês padrão em America/Sao_Paulo mesmo com o servidor em UTC (01/11 02:00 UTC = 31/10 em SP)', async () => {
    process.env.TZ = 'UTC'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T02:00:00.000Z'))
    const j = (await (await get()).json()).data
    expect(j.periodo).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(m.txFindMany.mock.calls[0][0].where.transaction_date).toEqual({
      gte: new Date('2026-10-01T00:00:00.000Z'), lte: new Date('2026-10-31T00:00:00.000Z'),
    })
  })

  // Onda 4 §10 (m15): o teste mexe no TZ ele mesmo e restaura com a mesma função do afterEach — vale isolado ou embaralhado.
  it('E11: restaurar o TZ devolve o original sem virar a string "undefined" (com e sem TZ original)', () => {
    process.env.TZ = 'UTC'
    restaurarTZ(undefined)
    expect('TZ' in process.env).toBe(false)
    expect(process.env.TZ).toBeUndefined()
    process.env.TZ = 'UTC'
    restaurarTZ('America/Sao_Paulo')
    expect(process.env.TZ).toBe('America/Sao_Paulo')
    restaurarTZ(TZ_ORIGINAL)
    expect(process.env.TZ).toBe(TZ_ORIGINAL)
  })

  it('mês padrão de fevereiro em ano não bissexto termina no dia 28', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-02-15T15:00:00.000Z'))
    const j = (await (await get()).json()).data
    expect(j.periodo).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('período válido e conta do livro: soma as transações da conta', async () => {
    m.accFindFirst.mockResolvedValue({ id: 'acc1' })
    m.txFindMany.mockResolvedValue([{ transaction_type: 'DEBIT', amount: 1000, bank_ref: null, categories: { name: 'Energia' } }])
    const j = (await (await get('?from=2026-10-01&to=2026-10-31&account_id=acc1')).json()).data
    expect(m.txFindMany.mock.calls[0][0].where.account_id).toEqual({ in: ['acc1'] })
    expect(j.saidas).toEqual([{ categoria: 'Energia', total: 1000 }])
    expect(j.contas).toEqual([{ id: 'acc1', nome: 'Itaú' }])
  })
})
