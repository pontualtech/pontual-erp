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

// F2-D (#4): a conta (accounts) é travada antes de a AR ser atualizada e antes da checagem "já lançado".
const ordemTravas = (modeloAR: string) => {
  const trava = banco.travas.find((t) => t.tabela === 'accounts')!
  expect(trava).toBeDefined()
  const primeiro = (f: (o: (typeof banco.log)[number]) => boolean) => banco.log.find(f)?.seq ?? Infinity
  expect(trava.seq).toBeLessThan(primeiro((o) => o.modelo === modeloAR && ['update', 'updateMany', 'create'].includes(o.op)))
  expect(trava.seq).toBeLessThan(primeiro((o) => o.modelo === 'transaction' && ['findFirst', 'create'].includes(o.op)))
}

describe('F2-D (#4): webhook Inter trava a conta antes da AR', () => {
  it('accounts (Inter) antes de accountReceivable.update e do ondeRef', async () => {
    await evento(pago('PAGO'))
    expect(banco.travas[0]).toEqual(expect.objectContaining({ tabela: 'accounts', id: 'inter' }))
    ordemTravas('accountReceivable')
  })
})

describe('F3-E (#5): webhook Inter decide pela AR relida com a trava', () => {
  it('Receber concorrente comitou enquanto esperava a trava → não sobrescreve o recebido nem cria 2º crédito', async () => {
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts') return
      Object.assign(banco.tabelas.accountReceivable[0], { status: 'RECEBIDO', received_amount: 50000 })
      banco.transacao({ account_id: 'inter', transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:r1' })
      banco.aoTravar(null)
    })
    await evento({ ...pago('PAGO'), valorPago: 480 })
    expect(banco.tabelas.accountReceivable[0]).toEqual(expect.objectContaining({ status: 'RECEBIDO', received_amount: 50000, reconciled: true }))
    expect(doAR()).toHaveLength(1)
    expect(banco.travas.map((t) => t.tabela)).toEqual(['accounts', 'accounts_receivable'])
  })
})
