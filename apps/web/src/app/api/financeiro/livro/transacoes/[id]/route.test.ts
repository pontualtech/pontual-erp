import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { m, db } = vi.hoisted(() => { const m = {
  txFindFirst: vi.fn(), txUpdate: vi.fn(), txUpdateMany: vi.fn(), txCount: vi.fn(),
  catFindFirst: vi.fn(), catFindMany: vi.fn(),
  ruleFindFirst: vi.fn(), ruleFindMany: vi.fn(), ruleCreate: vi.fn(), ruleUpdate: vi.fn(),
}
const db = {
  transaction: { findFirst: m.txFindFirst, update: m.txUpdate, updateMany: m.txUpdateMany, count: m.txCount },
  category: { findFirst: m.catFindFirst, findMany: m.catFindMany },
  classificationRule: { findFirst: m.ruleFindFirst, findMany: m.ruleFindMany, create: m.ruleCreate, update: m.ruleUpdate },
  $transaction: async (cb: (tx: unknown) => unknown) => cb(db),
}
return { m, db } })
vi.mock('@pontual/db', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { PATCH } from './route'
import { classificar } from '@/lib/financeiro/livro'

const patch = (body: unknown) => PATCH(
  new NextRequest('http://x/api/financeiro/livro/transacoes/t1', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }),
  { params: { id: 't1' } },
)

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.txFindFirst.mockResolvedValue({ id: 't1', category_id: 'fb', source_text: 'PIX ENVIADO ELVIS FERREIRA', description: 'x' })
  m.catFindFirst.mockResolvedValue({ id: 'cat1', name: 'Telefone e Internet' })
  m.catFindMany.mockResolvedValue([{ id: 'fb1' }, { id: 'fb2' }])
  m.ruleFindFirst.mockResolvedValue(null)
  m.ruleFindMany.mockResolvedValue([])
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
    m.ruleFindFirst.mockResolvedValue({ id: 'r1', category_id: 'cat1' })
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

  it('categoria escolhida é fallback: não cria/atualiza regra nem recategoriza', async () => {
    m.catFindFirst.mockResolvedValue({ id: 'fb1', name: 'A classificar' })
    m.ruleFindFirst.mockResolvedValue({ id: 'r1', category_id: 'antiga' })
    const j = (await (await patch({ category_id: 'fb1', criar_regra: { direction: 'OUT' } })).json()).data
    expect(m.txUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { category_id: 'fb1' } })
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(m.ruleUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).not.toHaveBeenCalled()
    expect(j.regra).toBeNull()
    expect(j.motivo_sem_regra).toBe('categoria provisória não vira regra')
    expect(j.regra_criada).toBe(false)
    expect(j.regra_atualizada).toBe(false)
    expect(j.recategorizadas).toBe(0)
  })

  it('simular com categoria fallback: regra null com o motivo', async () => {
    m.catFindFirst.mockResolvedValue({ id: 'fb2', name: 'Receita a identificar' })
    const j = (await (await patch({ category_id: 'fb2', simular: true, criar_regra: { pattern: 'FULANO', direction: 'IN' } })).json()).data
    expect(j.regra).toBeNull()
    expect(j.motivo_sem_regra).toBe('categoria provisória não vira regra')
    expect(j.regra_criada).toBe(false)
    expect(j.recategorizadas).toBe(0)
  })

  it('(a) regra existente com outra categoria: atualiza a regra, não cria', async () => {
    m.ruleFindFirst.mockResolvedValue({ id: 'r1', category_id: 'antiga' })
    const j = (await (await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })).json()).data
    expect(m.ruleUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { category_id: 'cat1' } })
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(j.regra_atualizada).toBe(true)
    expect(j.regra_criada).toBe(false)
  })

  it('(b) regra existente com a mesma categoria: nada de create/update', async () => {
    m.ruleFindFirst.mockResolvedValue({ id: 'r1', category_id: 'cat1' })
    const j = (await (await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })).json()).data
    expect(m.ruleUpdate).not.toHaveBeenCalled()
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(j.regra_atualizada).toBe(false)
    expect(j.regra_criada).toBe(false)
  })

  it('(c) simular com regra de outra categoria: informa regra_atualizada e não grava', async () => {
    m.ruleFindFirst.mockResolvedValue({ id: 'r1', category_id: 'antiga' })
    const j = (await (await patch({ category_id: 'cat1', simular: true, criar_regra: { direction: 'OUT' } })).json()).data
    expect(j.regra_atualizada).toBe(true)
    expect(j.regra_criada).toBe(false)
    expect(m.ruleUpdate).not.toHaveBeenCalled()
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(m.txUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).not.toHaveBeenCalled()
  })

  describe('a última resposta vence (prioridade)', () => {
    const CLARO = { id: 'seed', pattern: 'CLARO', direction: 'OUT', account_id: null, category_id: 'catTel', priority: 100 }
    const linhaClaro = { id: 't1', category_id: 'catTel', source_text: 'DA CLARO CELULAR 6', description: 'x', account_id: 'acc1', transaction_type: 'DEBIT', counterparty: null }

    it('regra nova fica com prioridade menor que a da regra antiga que casa (CLARO 100 → 99) e vence o classificar', async () => {
      m.txFindFirst.mockResolvedValue(linhaClaro)
      m.ruleFindMany.mockResolvedValue([
        CLARO,
        { id: 'in', pattern: 'CLARO', direction: 'IN', account_id: null, category_id: 'x', priority: 10 }, // outra direção
        { id: 'netflix', pattern: 'NETFLIX', direction: 'OUT', account_id: null, category_id: 'y', priority: 5 }, // não casa
        { id: 'conta', pattern: 'CELULAR', direction: null, account_id: 'outra-conta', category_id: 'z', priority: 1 }, // outra conta
      ])
      await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })
      expect(m.ruleFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { company_id: 'c1', active: true } }))
      expect(m.ruleCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ pattern: 'DA CLARO CELULAR 6', direction: 'OUT', category_id: 'cat1', priority: 99 }) })
      const nova = { id: 'nova', ...m.ruleCreate.mock.calls[0][0].data }
      const linha = { chave: 'k', data: '2026-10-30', descricao: 'DA CLARO CELULAR 6', valor_centavos: -5990 }
      expect(classificar(linha, [CLARO, nova], 'acc1').category_id).toBe('cat1')
    })

    it('busca a regra existente sem diferenciar maiúsculas e baixa a prioridade dela ao trocar a categoria', async () => {
      m.txFindFirst.mockResolvedValue(linhaClaro)
      m.ruleFindFirst.mockResolvedValue({ id: 'r1', category_id: 'antiga', priority: 100 })
      m.ruleFindMany.mockResolvedValue([CLARO, { id: 'r1', pattern: 'da claro celular 6', direction: 'OUT', account_id: null, category_id: 'antiga', priority: 100 }])
      const j = (await (await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })).json()).data
      expect(m.ruleFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { company_id: 'c1', active: true, pattern: { equals: 'DA CLARO CELULAR 6', mode: 'insensitive' }, direction: 'OUT' },
      }))
      expect(m.ruleUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { category_id: 'cat1', priority: 99 } })
      expect(m.ruleCreate).not.toHaveBeenCalled()
      expect(j.regra_atualizada).toBe(true)
    })

    it('regra existente com a mesma categoria que perde para outra: só baixa a prioridade', async () => {
      m.txFindFirst.mockResolvedValue(linhaClaro)
      m.ruleFindFirst.mockResolvedValue({ id: 'r1', category_id: 'cat1', priority: 100 })
      m.ruleFindMany.mockResolvedValue([{ ...CLARO, priority: 50 }])
      await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })
      expect(m.ruleUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { priority: 49 } })
    })

    it('regra existente que já vence: não mexe na prioridade', async () => {
      m.txFindFirst.mockResolvedValue(linhaClaro)
      m.ruleFindFirst.mockResolvedValue({ id: 'r1', category_id: 'cat1', priority: 10 })
      m.ruleFindMany.mockResolvedValue([CLARO])
      await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })
      expect(m.ruleUpdate).not.toHaveBeenCalled()
    })
  })
})
