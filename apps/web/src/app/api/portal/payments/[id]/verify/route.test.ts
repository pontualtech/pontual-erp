import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/portal-auth', () => ({ getPortalUserFromRequest: () => ({ company_id: 'c1', customer_id: 'cli1' }) }))
vi.mock('@/lib/observability', () => ({ logError: vi.fn(async () => undefined) }))
const { remoto } = vi.hoisted(() => ({ remoto: { status: 'RECEIVED' } }))
vi.mock('@/lib/payments/factory', () => ({
  getPaymentProvider: () => ({ getStatus: async () => ({ status: remoto.status, paidAt: new Date('2026-11-01T15:00:00Z') }) }),
  getPaymentProviderForAccount: async () => null,
}))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'
import { logError } from '@/lib/observability'

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

  it('corrida: o webhook RECEIVED comita enquanto o verify espera a trava (do Payment) → Payment não regride e a AR não soma 2x', async () => {
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'payments') return
      pag().status = 'RECEIVED'
      Object.assign(ar(), { status: 'LIQUIDADO', received_amount: 10000, reconciled: true })
      banco.aoTravar(null)
    })
    expect((await verificar()).status).toBe(200)
    expect(pag().status).toBe('RECEIVED')
    expect(ar()).toEqual(expect.objectContaining({ received_amount: 10000, status: 'LIQUIDADO' }))
    expect(banco.travas.map((t) => t.tabela)).toEqual(['payments', 'accounts_receivable'])
  })

  it('webhook CONFIRMED comitado durante a espera (AR com outra parte em aberto) → o pagamento não soma de novo', async () => {
    Object.assign(ar(), { total_amount: 20000 })
    // F7-F: o webhook comitou enquanto o verify esperava a 1ª trava (a do Payment, como no webhook).
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'payments') return
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

describe('F7-F (#9, #17, m9): verify na ordem do webhook e sem erro cru', () => {
  it('trava o Payment (FOR UPDATE) antes da AR — a ordem do webhook; nenhuma leitura/escrita do Payment antes da trava', async () => {
    expect((await verificar()).status).toBe(200)
    expect(banco.travas.map((t) => [t.tabela, t.id])).toEqual([['payments', 'p1'], ['accounts_receivable', 'r1']])
    const trava = banco.travas[0].seq
    const dentro = banco.log.filter((o) => o.dentroDaTx && o.modelo === 'payment')
    expect(dentro.every((o) => o.seq > trava)).toBe(true)
  })

  it('deadlock (P2010 / 40P01) → 409 "Estamos confirmando seu pagamento; tente de novo em instantes." — nunca o texto do banco', async () => {
    banco.tx.payment.updateMany.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Invalid `tx.payment.updateMany()` invocation: Raw query failed. Code: `40P01`. deadlock detected'), { code: 'P2010', meta: { code: '40P01' } })
    })
    const { status, j } = await verificar()
    expect(status).toBe(409)
    expect(j).toEqual({ error: 'Estamos confirmando seu pagamento; tente de novo em instantes.' })
  })

  it('erro inesperado → 500 com mensagem genérica (sem Prisma) e o erro vai para o log', async () => {
    banco.tx.accountReceivable.update.mockImplementationOnce(async () => { throw new Error('Invalid `tx.accountReceivable.update()` invocation: boom') })
    const { status, j } = await verificar()
    expect(status).toBe(500)
    expect(j.error).not.toMatch(/prisma|invocation|tx\./i)
    expect(logError).toHaveBeenCalled()
  })
})
