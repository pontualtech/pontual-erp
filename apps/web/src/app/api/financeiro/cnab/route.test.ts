import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { retornos } = vi.hoisted(() => ({ retornos: { lista: [] as unknown[] } }))
vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
// O arquivo .ret em si não importa aqui: o parser devolve o retorno já decodificado.
vi.mock('@/lib/boleto/cnab/cnab400-inter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/boleto/cnab/cnab400-inter')>()),
  parsearRetornoCNAB400: () => retornos.lista,
}))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'

const importar = () => POST(new NextRequest('http://x/api/financeiro/cnab', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'x'.repeat(400) }),
}))
const cnab = () => banco.tabelas.transaction.filter((t) => t.bank_ref === 'cnab:123' || t.linked_ref === 'cnab:123')

const retorno = (seuNumero: string, nossoNumero: string) => ({ seuNumero, nossoNumero, valorPago: 50000, dataCredito: new Date('2026-11-01T00:00:00Z'), status: 'PAGO' })

beforeEach(() => {
  retornos.lista = [retorno('r1', '123')]
  vi.spyOn(console, 'log').mockImplementation(() => {})
  banco.reset()
  banco.conta({ id: 'inter', name: 'Inter', current_balance: 0 })
  banco.inserir('setting', { company_id: 'c1', key: 'cnab.account_id', value: 'inter' })
})

describe('retorno CNAB — "já lançado" vale também para o crédito convertido pelo livro (onda 4, fix 1)', () => {
  it('controle: retorno PAGO → CREDIT cnab:123 e saldo', async () => {
    banco.ar({ id: 'r1', status: 'PENDENTE', total_amount: 50000 })
    expect((await importar()).status).toBe(200)
    expect(cnab()).toEqual([expect.objectContaining({ bank_ref: 'cnab:123', amount: 50000 })])
    expect(banco.saldo('inter')).toBe(50000)
  })

  it('reimportar com a conta de volta a PENDENTE, depois que o crédito virou linha BANCO (linked_ref cnab:123): não cria 2º crédito', async () => {
    banco.ar({ id: 'r1', status: 'PENDENTE', total_amount: 50000 })
    banco.transacao({ account_id: 'inter', transaction_type: 'CREDIT', amount: 50000, origin: 'BANCO', bank_ref: 'INTER:k', linked_ref: 'cnab:123' })
    banco.tabelas.account[0].current_balance = 50000
    await importar()
    expect(cnab()).toHaveLength(1)
    expect(banco.saldo('inter')).toBe(50000)
  })
})

// F2-D (#4): a conta (accounts) é travada antes de a AR ser atualizada e antes da checagem "já lançado".
const ordemTravas = (modeloAR: string) => {
  const trava = banco.travas.find((t) => t.tabela === 'accounts')!
  expect(trava).toBeDefined()
  const primeiro = (f: (o: (typeof banco.log)[number]) => boolean) => banco.log.find(f)?.seq ?? Infinity
  expect(trava.seq).toBeLessThan(primeiro((o) => o.modelo === modeloAR && ['update', 'updateMany', 'create'].includes(o.op)))
  expect(trava.seq).toBeLessThan(primeiro((o) => o.modelo === 'transaction' && ['findFirst', 'create'].includes(o.op)))
}

describe('F2-D (#4): retorno CNAB trava a conta antes da AR', () => {
  it('accounts (Inter) antes de accountReceivable.update e do ondeRef', async () => {
    banco.ar({ id: 'r1', status: 'PENDENTE', total_amount: 50000 })
    await importar()
    expect(banco.travas[0]).toEqual(expect.objectContaining({ tabela: 'accounts', id: 'inter' }))
    ordemTravas('accountReceivable')
  })
})

describe('F3-E (#5): CNAB decide pela AR relida com a trava', () => {
  it('Receber concorrente comitou enquanto o CNAB esperava a trava → nenhum 2º crédito e a AR não é sobrescrita', async () => {
    banco.ar({ id: 'r1', status: 'PENDENTE', total_amount: 50000, payment_method: 'PIX' })
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts') return
      Object.assign(banco.tabelas.accountReceivable[0], { status: 'RECEBIDO', received_amount: 50000 })
      banco.transacao({ account_id: 'inter', transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:r1' })
      banco.aoTravar(null)
    })
    await importar()
    expect(cnab()).toEqual([])
    expect(banco.tabelas.accountReceivable[0]).toEqual(expect.objectContaining({ status: 'RECEBIDO', payment_method: 'PIX' }))
    expect(banco.travas.map((t) => t.tabela)).toEqual(['accounts', 'accounts_receivable'])
  })
})

describe('F3-D (#4, m3): retorno CNAB — opções da tx e conflito por AR', () => {
  it('cada AR numa $transaction com maxWait 10s e timeout 20s', async () => {
    banco.ar({ id: 'r1', status: 'PENDENTE', total_amount: 50000 })
    await importar()
    expect(banco.transacoes.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }])
  })

  it('P2034 numa AR → erro daquela linha no resultado e as demais ARs processadas (nunca 500 do arquivo)', async () => {
    retornos.lista = [retorno('r1', '123'), retorno('r2', '456')]
    banco.ar({ id: 'r1', status: 'PENDENTE', total_amount: 50000 })
    banco.ar({ id: 'r2', status: 'PENDENTE', total_amount: 50000 })
    banco.tx.transaction.create.mockImplementationOnce(async () => { throw Object.assign(new Error('deadlock detected'), { code: 'P2034' }) })
    const res = await importar()
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.erros).toEqual([{ seuNumero: 'r1', nossoNumero: '123', erro: 'conflito com outra operação — repita' }])
    expect(j.pagos).toBe(1)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'cnab:456')).toHaveLength(1)
    expect(cnab()).toEqual([])
  })
})
