import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const transferir = async (de: string, para: string) => {
  const res = await POST(new NextRequest('http://x/api/financeiro/transferencia', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from_account_id: de, to_account_id: para, amount: 10000 }),
  }))
  return res.status
}

beforeEach(() => {
  banco.reset()
  banco.conta({ id: A, name: 'Itau', current_balance: 50000 })
  banco.conta({ id: B, name: 'Asaas', current_balance: 50000 })
})

describe('F3-J (m1): transferência trava as duas contas (ordem por id) antes de escrever', () => {
  it('B → A: trava A e depois B, antes de qualquer account.update/transaction.create; saldos movidos', async () => {
    expect(await transferir(B, A)).toBe(200)
    const contas = banco.travas.filter((t) => t.tabela === 'accounts')
    expect(contas.map((t) => t.id)).toEqual([A, B])
    const escrita = banco.log.find((o) => ['account', 'transaction'].includes(o.modelo) && ['update', 'create'].includes(o.op))!
    expect(Math.max(...contas.map((t) => t.seq))).toBeLessThan(escrita.seq)
    expect(banco.log.filter((o) => o.op === 'queryRaw').every((o) => o.dentroDaTx)).toBe(true)
    expect([banco.saldo(A), banco.saldo(B)]).toEqual([60000, 40000])
  })
})
