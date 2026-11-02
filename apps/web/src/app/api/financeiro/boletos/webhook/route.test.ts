import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'

const SEGREDO = 'segredo-teste'
const evento = async (body: Record<string, unknown>) => {
  const raw = JSON.stringify(body)
  const sig = createHmac('sha256', SEGREDO).update(raw).digest('hex')
  const res = await POST(new NextRequest('http://x/api/financeiro/boletos/webhook', { method: 'POST', headers: { 'x-webhook-secret': sig }, body: raw }))
  return (await res.json()) as Record<string, unknown>
}
const pago = (situacao: string) => ({ nossoNumero: '123', seuNumero: 'r1', valorPago: 500, dataPagamento: '2026-11-01', situacao })
const doAR = () => banco.tabelas.transaction.filter((t) => t.bank_ref === 'AR:r1' || t.linked_ref === 'AR:r1')

beforeEach(() => {
  process.env.BOLETO_WEBHOOK_SECRET = SEGREDO
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  banco.reset()
  banco.inserir('company', { id: 'c1', is_active: true })
  banco.conta({ id: 'inter', name: 'Inter', current_balance: 0 })
  banco.ar({ id: 'r1', account_id: 'inter', total_amount: 50000, boleto_url: 'https://boleto', pix_code: JSON.stringify({ nossoNumero: '123' }) })
})
afterEach(() => { delete process.env.BOLETO_WEBHOOK_SECRET })

describe('webhook de boleto Inter — "já lançado" vale também para o crédito convertido pelo livro (onda 4, fix 1)', () => {
  it('controle: pagamento → CREDIT AR:r1 e saldo', async () => {
    await evento(pago('PAGO'))
    expect(doAR()).toEqual([expect.objectContaining({ bank_ref: 'AR:r1', transaction_type: 'CREDIT', amount: 50000 })])
    expect(banco.saldo('inter')).toBe(50000)
  })

  it('evento repetido (outro event_id) depois que o crédito virou linha BANCO (linked_ref AR:r1): não cria 2º crédito', async () => {
    await evento(pago('PAGO'))
    Object.assign(doAR()[0], { origin: 'BANCO', bank_ref: 'INTER:2026-11-01|BOLETO|+50000|1', linked_ref: 'AR:r1' })
    await evento(pago('PAGA'))
    expect(doAR()).toHaveLength(1)
    expect(banco.saldo('inter')).toBe(50000)
  })
})
