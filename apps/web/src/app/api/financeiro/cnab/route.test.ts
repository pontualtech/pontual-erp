import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
// O arquivo .ret em si não importa aqui: o parser devolve o retorno já decodificado.
vi.mock('@/lib/boleto/cnab/cnab400-inter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/boleto/cnab/cnab400-inter')>()),
  parsearRetornoCNAB400: () => [{ seuNumero: 'r1', nossoNumero: '123', valorPago: 50000, dataCredito: new Date('2026-11-01T00:00:00Z'), status: 'PAGO' }],
}))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'

const importar = () => POST(new NextRequest('http://x/api/financeiro/cnab', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'x'.repeat(400) }),
}))
const cnab = () => banco.tabelas.transaction.filter((t) => t.bank_ref === 'cnab:123' || t.linked_ref === 'cnab:123')

beforeEach(() => {
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
