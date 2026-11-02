import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { DELETE } from './route'
import { banco } from '@/test-utils/banco-falso'

const excluir = async () => {
  const res = await DELETE(new NextRequest('http://x/api', { method: 'DELETE' }), { params: { id: 'p1' } })
  return { status: res.status, j: await res.json() }
}
const AP = { id: 'p1', status: 'PENDENTE', paid_amount: 2000, total_amount: 5000, account_id: 'acc1' }
const ap = () => banco.tabelas.accountPayable.find((a) => a.id === 'p1')!
const PROPRIOS = 'há lançamentos financeiros desta conta; estorne antes de excluir'
const LIGADA = 'Há lançamento do banco ligado; estorne antes de excluir.'
const t = (bank_ref: string, transaction_type: string, amount: number) => banco.transacao({ account_id: 'acc1', bank_ref, transaction_type, amount })

beforeEach(() => {
  banco.reset()
  banco.conta({ id: 'acc1' })
  banco.conta({ id: 'acc2' })
})

describe('DELETE conta a pagar — livro-razão', () => {
  it('sem lançamento nenhum: exclui (soft delete)', async () => {
    banco.ap(AP)
    expect((await excluir()).status).toBe(200)
    expect(ap().deleted_at).toBeInstanceOf(Date)
  })

  it('linha do banco ligada (AP:id — baixa ou DEBIT convertido): 409 com o texto da linha ligada', async () => {
    banco.ap(AP)
    banco.transacao({ account_id: 'acc1', origin: 'BANCO', bank_ref: 'K', transaction_type: 'DEBIT', amount: 2000, linked_ref: 'AP:p1' })
    expect((await excluir()).j.error).toBe(LIGADA)
    expect(ap().deleted_at).toBeNull()
  })

  it('E4: próprio que não se anula: 409; m14: já estornada (DEBIT − CREDIT :estorno = 0) sem linha ligada: exclui', async () => {
    banco.ap(AP)
    t('AP:p1', 'DEBIT', 2000)
    expect((await excluir()).j.error).toBe(PROPRIOS)
    t('AP:p1:estorno', 'CREDIT', 2000)
    expect((await excluir()).status).toBe(200)
  })

  it('combinação inesperada (CREDIT AP:id) não conta como anulada: 409', async () => {
    banco.ap(AP)
    t('AP:p1', 'DEBIT', 2000)
    t('AP:p1', 'CREDIT', 2000)
    expect((await excluir()).j.error).toBe(PROPRIOS)
  })

  it('AP paga continua bloqueada pelo guard antigo (409)', async () => {
    banco.ap({ ...AP, status: 'PAGO', paid_amount: 5000 })
    expect((await excluir()).status).toBe(409)
  })
})

describe('§7/G2: trava conta → AP e decide pela releitura', () => {
  it('trava accounts (conta da AP) antes da AP; soft delete pelo tx depois das travas', async () => {
    banco.ap(AP)
    await excluir()
    expect(banco.travas.map((x) => [x.tabela, x.id])).toEqual([['accounts', 'acc1'], ['accounts_payable', 'p1']])
    const escrita = banco.log.find((o) => o.modelo === 'accountPayable' && o.op === 'updateMany')!
    expect(escrita.cliente).toBe('tx')
    expect(escrita.seq).toBeGreaterThan(banco.travas[1].seq)
    expect(banco.prismaDentroDaTx()).toEqual([])
  })

  it('AP ficou paga enquanto esperava: 409; estornada antes da trava: libera', async () => {
    banco.ap(AP)
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_payable') Object.assign(ap(), { status: 'PAGO', paid_amount: 5000 }) })
    expect((await excluir()).status).toBe(409)
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_payable') Object.assign(ap(), { status: 'PENDENTE', paid_amount: 0 }) })
    expect((await excluir()).status).toBe(200)
  })

  it('excluída em paralelo → 404; conta bancária trocada enquanto esperava → 409 "conta alterada — repita"', async () => {
    banco.ap(AP)
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_payable') ap().deleted_at = new Date() })
    expect((await excluir()).status).toBe(404)
    ap().deleted_at = null
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_payable') ap().account_id = 'acc2' })
    const r = await excluir()
    expect(r.status).toBe(409)
    expect(r.j.error).toBe('conta alterada — repita')
  })
})

describe('fix 1.4 (#15, espelho na AP)', () => {
  it('estornada antes do branch (só CREDIT AP:id:estorno, sem DEBIT AP:id): exclui (200)', async () => {
    banco.ap({ ...AP, paid_amount: 0 })
    t('AP:p1:estorno', 'CREDIT', 2000)
    expect((await excluir()).status).toBe(200)
    expect(ap().deleted_at).toBeInstanceOf(Date)
  })

  it('com DEBIT AP:id ainda vivo o estorno parcial não basta: 409', async () => {
    banco.ap({ ...AP, paid_amount: 0 })
    t('AP:p1', 'DEBIT', 2000)
    t('AP:p1:estorno', 'CREDIT', 1000)
    expect((await excluir()).j.error).toBe(PROPRIOS)
  })
})

describe('F2-G (m21): opções da $transaction', () => {
  it('maxWait 10s e timeout 20s', async () => {
    banco.ap(AP)
    await excluir()
    expect(banco.transacoes.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }])
  })
})
