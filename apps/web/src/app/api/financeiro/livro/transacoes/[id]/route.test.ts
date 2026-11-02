import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// §10 (onda 4): `prisma` (fora) e `tx` (dentro do $transaction) são clientes DISTINTOS, cada um só com o que a rota
// pode chamar nele — uma leitura/gravação pelo cliente errado quebra o teste (TypeError) em vez de passar calada.
const { m, db } = vi.hoisted(() => { const m = {
  txFindFirst: vi.fn(), txUpdate: vi.fn(), txUpdateMany: vi.fn(), txCount: vi.fn(), pTxFindMany: vi.fn(),
  catFindFirst: vi.fn(), catFindMany: vi.fn(), txCatFindMany: vi.fn(),
  ruleFindFirst: vi.fn(), txRuleFindFirst: vi.fn(), ruleFindMany: vi.fn(), ruleCreate: vi.fn(), ruleUpdate: vi.fn(),
  queryRaw: vi.fn(), txOpcoes: vi.fn(),
}
const tx = {
  transaction: { update: m.txUpdate, updateMany: m.txUpdateMany },
  category: { findMany: m.txCatFindMany },
  classificationRule: { findFirst: m.txRuleFindFirst, findMany: m.ruleFindMany, create: m.ruleCreate, update: m.ruleUpdate },
  $queryRaw: m.queryRaw,
}
const db = {
  transaction: { findFirst: m.txFindFirst, count: m.txCount, findMany: m.pTxFindMany },
  category: { findFirst: m.catFindFirst, findMany: m.catFindMany },
  classificationRule: { findFirst: m.ruleFindFirst },
  $transaction: async (cb: (t: unknown) => unknown, opcoes?: unknown) => { m.txOpcoes(opcoes); return cb(tx) },
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

// updateMany da própria linha (where.id = 't1') × recategorização retroativa das outras (where.id = { not: 't1' }).
const linhaGravada = () => m.txUpdateMany.mock.calls.map((c) => c[0]).filter((a) => typeof a.where.id === 'string')
const retroativo = () => m.txUpdateMany.mock.calls.map((c) => c[0]).filter((a) => typeof a.where.id !== 'string')
const ONDE_DESLIGADA = { id: 't1', company_id: 'c1', origin: 'BANCO', linked_ref: null }
const ONDE_LIGADA = { id: 't1', company_id: 'c1', origin: 'BANCO', linked_ref: { not: null } }

// A regra ativa existente é lida pelo cliente de fora na simulação e pelo tx na gravação.
const regraExistente = (r: unknown) => { m.ruleFindFirst.mockResolvedValue(r); m.txRuleFindFirst.mockResolvedValue(r) }

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset())
  m.txFindFirst.mockResolvedValue({ id: 't1', category_id: 'fb', source_text: 'PIX ENVIADO ELVIS FERREIRA', description: 'x', origin: 'BANCO', linked_ref: null, account_id: 'acc1' })
  m.catFindFirst.mockResolvedValue({ id: 'cat1', name: 'Telefone e Internet' })
  m.catFindMany.mockResolvedValue([{ id: 'fb1' }, { id: 'fb2' }])
  m.txCatFindMany.mockResolvedValue([{ id: 'fb1' }, { id: 'fb2' }])
  m.pTxFindMany.mockResolvedValue([])
  m.queryRaw.mockResolvedValue([])
  regraExistente(null)
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
        account_id: { in: ['acc1'] },
      },
      data: { category_id: 'cat1' },
    })
    expect(j.regra).toEqual({ pattern: 'ELVIS FERREIRA', direction: 'OUT' })
    expect(j.regra_criada).toBe(true)
    expect(j.recategorizadas).toBe(3)
  })

  it('direção null não filtra por tipo', async () => {
    await patch({ category_id: 'cat1', criar_regra: { pattern: 'abc loja', direction: null } })
    const where = retroativo()[0].where
    expect(where).not.toHaveProperty('transaction_type')
    expect(where.source_text.contains).toBe('abc loja')
  })

  it('regra já existente: não cria, mas ainda recategoriza', async () => {
    regraExistente({ id: 'r1', category_id: 'cat1' })
    const j = (await (await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })).json()).data
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(retroativo()).toHaveLength(1)
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
    expect(retroativo()).toEqual([])
    expect(j.regra).toBeNull()
    expect(j.motivo_sem_regra).toBeTruthy()
    expect(j.recategorizadas).toBe(0)
  })

  it('texto genérico sem padrão seguro: regra null com motivo', async () => {
    m.txFindFirst.mockResolvedValue({ id: 't1', category_id: 'fb', source_text: 'PIX ENVIADO', description: 'x', origin: 'BANCO', linked_ref: null })
    const j = (await (await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })).json()).data
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(j.regra).toBeNull()
    expect(j.motivo_sem_regra).toMatch(/genérico/)
  })

  it('nota: description = source_text + " — " + nota', async () => {
    await patch({ category_id: 'cat1', nota: 'aluguel' })
    expect(linhaGravada()).toEqual([{
      where: ONDE_DESLIGADA,
      data: { category_id: 'cat1', description: 'PIX ENVIADO ELVIS FERREIRA — aluguel' },
    }])
  })

  it('categoria escolhida é fallback: não cria/atualiza regra nem recategoriza', async () => {
    m.catFindFirst.mockResolvedValue({ id: 'fb1', name: 'A classificar' })
    regraExistente({ id: 'r1', category_id: 'antiga' })
    const j = (await (await patch({ category_id: 'fb1', criar_regra: { direction: 'OUT' } })).json()).data
    expect(linhaGravada()).toEqual([{ where: ONDE_DESLIGADA, data: { category_id: 'fb1' } }])
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(m.ruleUpdate).not.toHaveBeenCalled()
    expect(retroativo()).toEqual([])
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
    regraExistente({ id: 'r1', category_id: 'antiga' })
    const j = (await (await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })).json()).data
    expect(m.ruleUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { category_id: 'cat1' } })
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(j.regra_atualizada).toBe(true)
    expect(j.regra_criada).toBe(false)
  })

  it('(b) regra existente com a mesma categoria: nada de create/update', async () => {
    regraExistente({ id: 'r1', category_id: 'cat1' })
    const j = (await (await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })).json()).data
    expect(m.ruleUpdate).not.toHaveBeenCalled()
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(j.regra_atualizada).toBe(false)
    expect(j.regra_criada).toBe(false)
  })

  it('(c) simular com regra de outra categoria: informa regra_atualizada e não grava', async () => {
    regraExistente({ id: 'r1', category_id: 'antiga' })
    const j = (await (await patch({ category_id: 'cat1', simular: true, criar_regra: { direction: 'OUT' } })).json()).data
    expect(j.regra_atualizada).toBe(true)
    expect(j.regra_criada).toBe(false)
    expect(m.ruleUpdate).not.toHaveBeenCalled()
    expect(m.ruleCreate).not.toHaveBeenCalled()
    expect(m.txUpdate).not.toHaveBeenCalled()
    expect(m.txUpdateMany).not.toHaveBeenCalled()
  })

  describe('F12: só linha do banco; linha ligada não vira regra e nota só anexa', () => {
    const ligada = {
      id: 't1', category_id: 'catEnergia', source_text: 'PGTO ELETROPAULO', description: 'Pgto: Luz · banco: PGTO ELETROPAULO',
      account_id: 'acc1', transaction_type: 'DEBIT', counterparty: null, origin: 'BANCO', linked_ref: 'AP:p1',
    }

    it('linha que não é do banco (origin ≠ BANCO): 422 e nada gravado', async () => {
      for (const origin of [null, 'OFX', 'ERP']) {
        m.txFindFirst.mockResolvedValue({ id: 't1', category_id: 'fb', source_text: null, description: 'Recebimento: OS 1', origin, linked_ref: null })
        const res = await patch({ category_id: 'cat1', nota: 'x', criar_regra: { direction: 'OUT' } })
        expect(res.status).toBe(422)
      }
      expect(m.txUpdate).not.toHaveBeenCalled()
      expect(m.ruleCreate).not.toHaveBeenCalled()
      expect(m.txUpdateMany).not.toHaveBeenCalled()
    })

    it('linha ligada: criar_regra ignorado (regra null + motivo), sem regra nem retroativo', async () => {
      m.txFindFirst.mockResolvedValue(ligada)
      const res = await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })
      expect(res.status).toBe(200)
      const j = (await res.json()).data
      expect(j.regra).toBeNull()
      expect(j.motivo_sem_regra).toBe('lançamento ligado a conta a receber/pagar')
      expect(j.regra_criada).toBe(false)
      expect(j.recategorizadas).toBe(0)
      expect(m.ruleCreate).not.toHaveBeenCalled()
      expect(m.ruleUpdate).not.toHaveBeenCalled()
      expect(retroativo()).toEqual([])
      expect(linhaGravada()).toEqual([{ where: ONDE_LIGADA, data: { category_id: 'cat1' } }])
    })

    it('linha ligada + simular: regra null com o motivo', async () => {
      m.txFindFirst.mockResolvedValue(ligada)
      const j = (await (await patch({ category_id: 'cat1', simular: true, criar_regra: { pattern: 'ELETROPAULO', direction: 'OUT' } })).json()).data
      expect(j.regra).toBeNull()
      expect(j.motivo_sem_regra).toBe('lançamento ligado a conta a receber/pagar')
      expect(j.recategorizadas).toBe(0)
      expect(m.txCount).not.toHaveBeenCalled()
    })

    it('linha ligada + nota: anexa à description atual (mantém a trilha Pgto: … · banco: …)', async () => {
      m.txFindFirst.mockResolvedValue(ligada)
      await patch({ category_id: 'cat1', nota: 'conta de outubro' })
      expect(linhaGravada()).toEqual([{
        where: ONDE_LIGADA,
        data: { category_id: 'cat1', description: 'Pgto: Luz · banco: PGTO ELETROPAULO — conta de outubro' },
      }])
    })
  })

  describe('E6: a linha só é gravada se continua ligada/desligada como foi lida', () => {
    const mudou = () => m.txUpdateMany.mockImplementation(async ({ where }: any) => ({ count: typeof where.id === 'string' ? 0 : 3 }))

    it('lida desligada, ligada antes de gravar (count 0): 409, sem regra nem retroativo', async () => {
      mudou()
      const res = await patch({ category_id: 'cat1', nota: 'x', criar_regra: { direction: 'OUT' } })
      expect(res.status).toBe(409)
      expect((await res.json()).error).toBe('lançamento mudou (ligado/desligado) — recarregue')
      expect(linhaGravada()).toEqual([{ where: ONDE_DESLIGADA, data: expect.anything() }])
      expect(m.ruleCreate).not.toHaveBeenCalled()
      expect(m.ruleUpdate).not.toHaveBeenCalled()
      expect(retroativo()).toEqual([])
    })

    it('lida ligada, desligada antes de gravar (count 0): 409', async () => {
      m.txFindFirst.mockResolvedValue({
        id: 't1', category_id: 'catEnergia', source_text: 'PGTO ELETROPAULO', description: 'Pgto: Luz · banco: PGTO ELETROPAULO',
        account_id: 'acc1', transaction_type: 'DEBIT', counterparty: null, origin: 'BANCO', linked_ref: 'AP:p1',
      })
      mudou()
      const res = await patch({ category_id: 'cat1', nota: 'x' })
      expect(res.status).toBe(409)
      expect(linhaGravada()).toEqual([{ where: ONDE_LIGADA, data: expect.anything() }])
    })
  })

  describe('a última resposta vence (prioridade)', () => {
    const CLARO = { id: 'seed', pattern: 'CLARO', direction: 'OUT', account_id: null, category_id: 'catTel', priority: 100 }
    const linhaClaro = { id: 't1', category_id: 'catTel', source_text: 'DA CLARO CELULAR 6', description: 'x', account_id: 'acc1', transaction_type: 'DEBIT', counterparty: null, origin: 'BANCO', linked_ref: null }

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
      regraExistente({ id: 'r1', category_id: 'antiga', priority: 100 })
      m.ruleFindMany.mockResolvedValue([CLARO, { id: 'r1', pattern: 'da claro celular 6', direction: 'OUT', account_id: null, category_id: 'antiga', priority: 100 }])
      const j = (await (await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })).json()).data
      expect(m.txRuleFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { company_id: 'c1', active: true, pattern: { equals: 'DA CLARO CELULAR 6', mode: 'insensitive' }, direction: 'OUT' },
      }))
      expect(m.ruleUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { category_id: 'cat1', priority: 99 } })
      expect(m.ruleCreate).not.toHaveBeenCalled()
      expect(j.regra_atualizada).toBe(true)
    })

    it('regra existente com a mesma categoria que perde para outra: só baixa a prioridade', async () => {
      m.txFindFirst.mockResolvedValue(linhaClaro)
      regraExistente({ id: 'r1', category_id: 'cat1', priority: 100 })
      m.ruleFindMany.mockResolvedValue([{ ...CLARO, priority: 50 }])
      await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })
      expect(m.ruleUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { priority: 49 } })
    })

    it('regra existente que já vence: não mexe na prioridade', async () => {
      m.txFindFirst.mockResolvedValue(linhaClaro)
      regraExistente({ id: 'r1', category_id: 'cat1', priority: 10 })
      m.ruleFindMany.mockResolvedValue([CLARO])
      await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })
      expect(m.ruleUpdate).not.toHaveBeenCalled()
    })
  })
})

describe('§7 (onda 4): trava as contas antes de gravar', () => {
  it('trava a conta da linha e as das linhas do retroativo (em ordem de id) antes de qualquer gravação; o retroativo fica nelas', async () => {
    m.pTxFindMany.mockResolvedValue([{ account_id: 'acc9' }, { account_id: 'acc1' }, { account_id: 'acc2' }])
    await patch({ category_id: 'cat1', criar_regra: { direction: 'OUT' } })
    const travas = m.queryRaw.mock.calls.map(([sql, ...v]) => [(sql as string[]).join('?'), ...v])
    expect(travas).toEqual(['acc1', 'acc2', 'acc9'].map((id) => ['SELECT id FROM accounts WHERE id = ? AND company_id = ? FOR UPDATE', id, 'c1']))
    const ultimaTrava = Math.max(...m.queryRaw.mock.invocationCallOrder)
    expect(Math.min(...m.txUpdateMany.mock.invocationCallOrder, ...m.ruleCreate.mock.invocationCallOrder)).toBeGreaterThan(ultimaTrava)
    expect(retroativo()[0].where.account_id).toEqual({ in: ['acc1', 'acc2', 'acc9'] })
  })

  it('m21: a tx do PATCH usa maxWait 10s e timeout 20s', async () => {
    await patch({ category_id: 'cat1' })
    expect(m.txOpcoes).toHaveBeenCalledWith({ maxWait: 10000, timeout: 20000 })
  })

  it('sem regra: trava só a conta da linha', async () => {
    await patch({ category_id: 'cat1' })
    expect(m.queryRaw).toHaveBeenCalledTimes(1)
    expect(m.queryRaw.mock.calls[0].slice(1)).toEqual(['acc1', 'c1'])
    expect(m.pTxFindMany).not.toHaveBeenCalled()
  })
})
