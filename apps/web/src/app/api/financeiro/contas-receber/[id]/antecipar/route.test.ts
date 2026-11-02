import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'

const ACC = 'acc1'

beforeEach(() => {
  banco.reset()
  banco.conta({ id: ACC, current_balance: 0 })
  banco.ar({ id: 'a1', status: 'PENDENTE', total_amount: 30000, payment_method: 'Cartão de crédito', description: 'OS 1' })
  for (const n of [1, 2, 3]) {
    banco.inserir('installment', { id: `i${n}`, parent_type: 'RECEIVABLE', parent_id: 'a1', status: 'PENDENTE', installment_number: n, amount: 10000, due_date: new Date() })
  }
})

describe('F3-J (m1): antecipação trava a conta antes de escrever', () => {
  it('trava a conta (accounts) antes das parcelas, do crédito AR:id:anticipation e do saldo', async () => {
    const res = await POST(new NextRequest('http://x/api/financeiro/contas-receber/a1/antecipar', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, account_id: ACC }),
    }), { params: { id: 'a1' } })
    expect(res.status).toBe(200)
    const trava = banco.travas.find((t) => t.tabela === 'accounts' && t.id === ACC)!
    expect(trava).toBeDefined()
    const escrita = banco.log.find((o) => ['installment', 'transaction', 'account', 'accountReceivable'].includes(o.modelo) && ['update', 'create'].includes(o.op))!
    expect(trava.seq).toBeLessThan(escrita.seq)
    expect(banco.tabelas.transaction).toEqual([expect.objectContaining({ bank_ref: 'AR:a1:anticipation', amount: 30000 })])
    expect(banco.saldo(ACC)).toBe(30000)
  })
})
