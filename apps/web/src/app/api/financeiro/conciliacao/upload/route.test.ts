import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { POST as upload } from './route'
import { POST as preview } from '../preview/route'
import { banco } from '@/test-utils/banco-falso'

const OFX = '<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261101<TRNAMT>500.00<FITID>FIT1<MEMO>PIX RECEBIDO</STMTTRN></BANKTRANLIST></OFX>'
const enviar = async (rota: typeof upload) => {
  const fd = new FormData()
  fd.append('file', new File([OFX], 'extrato.ofx'))
  fd.append('account_id', 'acc1')
  const res = await rota(new NextRequest('http://x/api', { method: 'POST', body: fd }))
  return (await res.json()).data
}
const doFit = () => banco.tabelas.transaction.filter((t) => t.bank_ref === 'FIT1' || t.linked_ref === 'FIT1')

beforeEach(() => {
  banco.reset()
  banco.conta({ id: 'acc1', current_balance: 0 })
})

describe('OFX — "já importado" vale também para a transação convertida pelo livro (onda 4, fix 1)', () => {
  it('controle: importa a linha e soma no saldo', async () => {
    await enviar(upload)
    expect(doFit()).toEqual([expect.objectContaining({ bank_ref: 'FIT1', amount: 50000 })])
    expect(banco.saldo('acc1')).toBe(50000)
  })

  it('reimportar depois que o livro converteu a transação (linked_ref FIT1): não importa de novo; a prévia marca como duplicada', async () => {
    banco.transacao({ account_id: 'acc1', transaction_type: 'CREDIT', amount: 50000, origin: 'BANCO', bank_ref: 'ITAU:k', linked_ref: 'FIT1' })
    banco.tabelas.account[0].current_balance = 50000
    const p = await enviar(preview)
    expect(p.transactions[0].is_duplicate).toBe(true)
    await enviar(upload)
    expect(doFit()).toHaveLength(1)
    expect(banco.saldo('acc1')).toBe(50000)
  })
})
