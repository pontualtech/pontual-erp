import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/portal-auth', () => ({ getPortalUserFromRequest: () => ({ company_id: 'c1', customer_id: 'cli1' }) }))
const { remoto } = vi.hoisted(() => ({ remoto: { status: 'RECEIVED' } }))
vi.mock('@/lib/payments/factory', () => ({
  getPaymentProvider: () => ({ getStatus: async () => ({ status: remoto.status, paidAt: new Date('2026-11-01T15:00:00Z') }) }),
  getPaymentProviderForAccount: async () => null,
}))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'

const verificar = async () => {
  const res = await POST(new NextRequest('http://x/api/portal/payments/p1/verify', { method: 'POST' }), { params: { id: 'p1' } })
  return { status: res.status, j: await res.json() }
}
const pag = () => banco.tabelas.payment[0]
const ar = () => banco.tabelas.accountReceivable[0]

beforeEach(() => {
  banco.reset()
  remoto.status = 'RECEIVED'
  banco.ar({ id: 'r1', status: 'PENDENTE', total_amount: 10000, received_amount: 0, description: 'OS 1' })
  banco.pagamento({ id: 'p1', customer_id: 'cli1', receivable_id: 'r1', provider: 'asaas', external_id: 'pay_1', status: 'PENDING', amount: 10000, billing_type: 'PIX' })
})

describe('F6-E (#8): "Já paguei?" do portal com as guardas do webhook', () => {
  it('controle: Asaas pago → Payment CONFIRMED e AR RECEBIDO 10000, numa tx com maxWait 10s / timeout 20s', async () => {
    expect((await verificar()).status).toBe(200)
    expect(pag().status).toBe('CONFIRMED')
    expect(ar()).toEqual(expect.objectContaining({ received_amount: 10000, status: 'RECEBIDO' }))
    expect(banco.transacoes.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }])
  })

  it('corrida: o webhook RECEIVED comita enquanto o verify espera a trava da AR → Payment não regride e a AR não soma 2x', async () => {
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts_receivable') return
      pag().status = 'RECEIVED'
      Object.assign(ar(), { status: 'LIQUIDADO', received_amount: 10000, reconciled: true })
      banco.aoTravar(null)
    })
    expect((await verificar()).status).toBe(200)
    expect(pag().status).toBe('RECEIVED')
    expect(ar()).toEqual(expect.objectContaining({ received_amount: 10000, status: 'LIQUIDADO' }))
    expect(banco.travas.map((t) => t.tabela)).toEqual(['accounts_receivable'])
  })

  it('webhook CONFIRMED comitado durante a espera (AR com outra parte em aberto) → o pagamento não soma de novo', async () => {
    Object.assign(ar(), { total_amount: 20000 })
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts_receivable') return
      pag().status = 'CONFIRMED'
      Object.assign(ar(), { received_amount: 10000, status: 'PENDENTE' })
      banco.aoTravar(null)
    })
    expect((await verificar()).status).toBe(200)
    expect(ar()).toEqual(expect.objectContaining({ received_amount: 10000, status: 'PENDENTE' }))
  })

  it('AR LIQUIDADO (conferida) não soma — quitada pelo isReceivableSettled, não só RECEBIDO', async () => {
    Object.assign(ar(), { status: 'LIQUIDADO', received_amount: 10000, reconciled: false })
    expect((await verificar()).status).toBe(200)
    expect(ar()).toEqual(expect.objectContaining({ received_amount: 10000, status: 'LIQUIDADO' }))
  })

  it('AR já quitada por outro meio (Receber manual) → não soma received_amount', async () => {
    Object.assign(ar(), { status: 'RECEBIDO', received_amount: 10000 })
    expect((await verificar()).status).toBe(200)
    expect(ar().received_amount).toBe(10000)
  })
})
