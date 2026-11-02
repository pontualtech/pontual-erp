import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { DELETE } from './route'
import { banco } from '@/test-utils/banco-falso'

const excluir = async () => {
  const res = await DELETE(new NextRequest('http://x/api', { method: 'DELETE' }), { params: { id: 'r1' } })
  return { status: res.status, j: await res.json() }
}
const AR = { id: 'r1', status: 'PENDENTE', received_amount: 5000, total_amount: 15000, reconciled: false, account_id: 'acc1' }
const ar = () => banco.tabelas.accountReceivable.find((a) => a.id === 'r1')!
const PROPRIOS = 'há lançamentos financeiros desta conta; estorne antes de excluir'
const LIGADA = 'Há lançamento do banco ligado; estorne antes de excluir.'
const t = (bank_ref: string, transaction_type: string, amount: number) => banco.transacao({ account_id: 'acc1', bank_ref, transaction_type, amount })

beforeEach(() => {
  banco.reset()
  banco.conta({ id: 'acc1' })
  banco.conta({ id: 'acc2' })
})

describe('DELETE conta a receber — livro-razão', () => {
  it('sem lançamento nenhum: exclui (soft delete)', async () => {
    banco.ar(AR)
    expect((await excluir()).status).toBe(200)
    expect(ar().deleted_at).toBeInstanceOf(Date)
  })

  it('linha do banco ligada (baixa ou nocional convertido: AR:id ou :anticipation): 409 com o texto da linha ligada', async () => {
    for (const ref of ['AR:r1', 'AR:r1:anticipation']) {
      banco.reset(); banco.conta({ id: 'acc1' }); banco.ar(AR)
      banco.transacao({ account_id: 'acc1', origin: 'BANCO', bank_ref: 'K', transaction_type: 'CREDIT', amount: 5000, linked_ref: ref })
      const { status, j } = await excluir()
      expect(status).toBe(409)
      expect(j.error).toBe(LIGADA)
      expect(ar().deleted_at).toBeNull()
    }
  })

  it('E4: lançamento próprio que não se anula (AR:id parcial): 409', async () => {
    banco.ar(AR)
    t('AR:r1', 'CREDIT', 2000)
    const { status, j } = await excluir()
    expect(status).toBe(409)
    expect(j.error).toBe(PROPRIOS)
    expect(ar().deleted_at).toBeNull()
  })

  it('m14 (E4a): conta já estornada (CREDIT AR:id − DEBIT :estorno = 0) e sem linha ligada: exclui (200)', async () => {
    banco.ar(AR)
    t('AR:r1', 'CREDIT', 5000)
    t('AR:r1:estorno', 'DEBIT', 5000)
    expect((await excluir()).status).toBe(200)
    expect(ar().deleted_at).toBeInstanceOf(Date)
  })

  it('já estornada mas com linha do banco ligada: 409 LIGADA; próprio que não se anula E linha ligada: 409 PROPRIOS', async () => {
    banco.ar(AR)
    t('AR:r1', 'CREDIT', 5000)
    t('AR:r1:estorno', 'DEBIT', 5000)
    banco.transacao({ account_id: 'acc1', origin: 'BANCO', bank_ref: 'K', transaction_type: 'CREDIT', amount: 5000, linked_ref: 'AR:r1' })
    expect((await excluir()).j.error).toBe(LIGADA)
    t('AR:r1', 'CREDIT', 1000)
    expect((await excluir()).j.error).toBe(PROPRIOS)
  })

  it('combinação inesperada (DEBIT AR:id) e crédito da antecipação nunca estornado: 409', async () => {
    banco.ar(AR)
    t('AR:r1', 'CREDIT', 5000)
    t('AR:r1', 'DEBIT', 5000)
    expect((await excluir()).j.error).toBe(PROPRIOS)
    banco.reset(); banco.conta({ id: 'acc1' }); banco.ar(AR)
    t('AR:r1:anticipation', 'CREDIT', 14000)
    expect((await excluir()).j.error).toBe(PROPRIOS)
  })

  it('AR recebida continua bloqueada pelo guard antigo (409)', async () => {
    banco.ar({ ...AR, status: 'RECEBIDO', received_amount: 15000 })
    expect((await excluir()).status).toBe(409)
  })
})

describe('§7/G2: trava conta → AR e decide pela releitura', () => {
  it('trava accounts (conta da AR) antes da AR; buscas e soft delete pelo tx, depois das travas', async () => {
    banco.ar(AR)
    expect((await excluir()).status).toBe(200)
    expect(banco.travas.map((x) => [x.tabela, x.id])).toEqual([['accounts', 'acc1'], ['accounts_receivable', 'r1']])
    const escrita = banco.log.find((o) => o.modelo === 'accountReceivable' && o.op === 'updateMany')!
    expect(escrita.cliente).toBe('tx')
    expect(escrita.seq).toBeGreaterThan(banco.travas[1].seq)
    expect(banco.prismaDentroDaTx()).toEqual([])
  })

  it('AR ficou recebida enquanto esperava a trava: 409 da guarda, nada apagado', async () => {
    banco.ar(AR)
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_receivable') Object.assign(ar(), { status: 'RECEBIDO', received_amount: 15000 }) })
    const { status, j } = await excluir()
    expect(status).toBe(409)
    expect(j.error).toBe('Esta conta está recebida. Estorne o recebimento antes de excluir (botão Estornar) para reverter o lançamento bancário.')
    expect(ar().deleted_at).toBeNull()
  })

  it('AR recebida foi estornada antes da trava: a releitura libera a exclusão', async () => {
    banco.ar({ ...AR, status: 'RECEBIDO', received_amount: 15000 })
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_receivable') Object.assign(ar(), { status: 'PENDENTE', received_amount: 0 }) })
    expect((await excluir()).status).toBe(200)
  })

  it('excluída em paralelo → 404; conta bancária trocada enquanto esperava → 409 "conta alterada — repita"', async () => {
    banco.ar(AR)
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_receivable') ar().deleted_at = new Date() })
    const r1 = await excluir()
    expect(r1.status).toBe(404)
    expect(r1.j.error).toBe('Conta a receber nao encontrada')
    ar().deleted_at = null
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_receivable') ar().account_id = 'acc2' })
    const r2 = await excluir()
    expect(r2.status).toBe(409)
    expect(r2.j.error).toBe('conta alterada — repita')
    expect(ar().deleted_at).toBeNull()
  })
})

describe('fix 1.4 (#15): o dinheiro da AR inclui Payments (pay_/acquirer:) e CNAB; estornada antes do branch pode ser excluída', () => {
  const linha = (linked_ref: string) => banco.transacao({ account_id: 'acc1', origin: 'BANCO', bank_ref: 'K', transaction_type: 'CREDIT', amount: 14500, linked_ref })

  it('#15: estornada antes do branch (só DEBIT AR:id:estorno, sem CREDIT AR:id): exclui (200)', async () => {
    banco.ar({ ...AR, received_amount: 0 })
    t('AR:r1:estorno', 'DEBIT', 15000)
    expect((await excluir()).status).toBe(200)
    expect(ar().deleted_at).toBeInstanceOf(Date)
  })

  it('#15: recebida pela maquininha e estornada antes do branch (CREDIT acquirer − DEBIT :estorno do bruto): exclui', async () => {
    banco.ar({ ...AR, received_amount: 0 })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'N1' })
    t('acquirer:rede:N1', 'CREDIT', 14500)
    t('AR:r1:estorno', 'DEBIT', 15000)
    expect((await excluir()).status).toBe(200)
  })

  it('crédito do adquirente / do CNAB ainda não compensado é dinheiro da conta: 409 (antes excluía e deixava o crédito órfão)', async () => {
    banco.ar({ ...AR, received_amount: 0, pix_code: JSON.stringify({ nossoNumero: '123' }) })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'N1' })
    t('acquirer:rede:N1', 'CREDIT', 14500)
    expect((await excluir()).j.error).toBe(PROPRIOS)
    banco.reset(); banco.conta({ id: 'acc1' })
    banco.ar({ ...AR, received_amount: 0, pix_code: JSON.stringify({ nossoNumero: '123' }) })
    t('cnab:123', 'CREDIT', 15000)
    expect((await excluir()).j.error).toBe(PROPRIOS)
  })

  it('linha BANCO convertida do adquirente / Asaas / CNAB conta como ligada: 409 com o texto da linha ligada', async () => {
    for (const [ref, preparar] of [
      ['acquirer:rede:N1', () => banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'N1' })],
      ['pay_1', () => banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_1' })],
      ['cnab:123', () => undefined],
    ] as const) {
      banco.reset(); banco.conta({ id: 'acc1' })
      banco.ar({ ...AR, received_amount: 0, pix_code: JSON.stringify({ nossoNumero: '123' }) })
      preparar()
      linha(ref)
      expect((await excluir()).j.error).toBe(LIGADA)
    }
  })

  it('cobrança Asaas devolvida (CREDIT pay_ líquido − DEBIT pay_-refund bruto): o estorno do próprio Asaas compensa → exclui', async () => {
    banco.ar({ ...AR, received_amount: 0 })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_1' })
    t('pay_1', 'CREDIT', 9700)
    t('pay_1-refund', 'DEBIT', 10000)
    expect((await excluir()).status).toBe(200)
  })

  it('com CREDIT AR:id ainda vivo o estorno parcial não basta: 409', async () => {
    banco.ar({ ...AR, received_amount: 0 })
    t('AR:r1', 'CREDIT', 5000)
    t('AR:r1:estorno', 'DEBIT', 3000)
    expect((await excluir()).j.error).toBe(PROPRIOS)
  })
})

describe('F2-G (m21): opções da $transaction', () => {
  it('maxWait 10s e timeout 20s', async () => {
    banco.ar(AR)
    await excluir()
    expect(banco.transacoes.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }])
  })
})
