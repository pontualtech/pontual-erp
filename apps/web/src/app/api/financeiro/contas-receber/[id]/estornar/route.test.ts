import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { POST as estornar } from './route'
import { POST as receber } from '../baixa/route'
import { POST as lancarLinhas } from '../../../livro/linhas/route'
import { banco } from '@/test-utils/banco-falso'

const ACC = '11111111-1111-4111-8111-111111111111'
const ACC2 = '22222222-2222-4222-8222-222222222222'
const dia = (d: string) => new Date(`${d}T00:00:00.000Z`)
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const est = async (id = 'r1', corpo: Record<string, unknown> = {}) => {
  const res = await estornar(new NextRequest('http://x/api', json(corpo)), { params: { id } })
  return { status: res.status, j: await res.json() }
}
const ar = (id = 'r1') => banco.tabelas.accountReceivable.find((a) => a.id === id)!
const doAR = (id = 'r1') => banco.tabelas.transaction.filter((t) => t.bank_ref?.startsWith(`AR:${id}`))

beforeEach(() => {
  banco.reset()
  banco.categoriasPadrao()
  banco.conta({ id: ACC, current_balance: 100000 })
  banco.conta({ id: ACC2, current_balance: 0 })
})

describe("§3 estorno de AR — 'permanece' não desliga linha nenhuma (F8-A)", () => {
  it('linhas da ref própria e de refs EXTERNAS (adquirente, Asaas, CNAB, antecipação) seguem ligadas; DEBIT AR:id:estorno pelo total na conta delas', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 50000, total_amount: 50000, pix_code: JSON.stringify({ nossoNumero: '777' }), anticipated_at: new Date('2026-10-20T12:00:00Z') })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1' })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_9' })
    const LIGADAS = [['P', 'AR:r1'], ['A', 'acquirer:rede:NSU1'], ['B', 'pay_9'], ['C', 'cnab:777'], ['D', 'AR:r1:anticipation']]
    for (const [id, ref] of LIGADAS) {
      banco.transacao({ id, account_id: ACC, transaction_type: 'CREDIT', amount: 10000, origin: 'BANCO', bank_ref: `K${id}`, source_text: `TXT ${id}`, linked_ref: ref })
    }
    expect((await est('r1', { dinheiro: 'permanece' })).status).toBe(200)
    for (const [id, ref] of LIGADAS) expect(banco.tx_(id)!.linked_ref).toBe(ref)
    // o dedupe dos produtores (ondeRef) continua achando o dinheiro do pay_9
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'pay_9' || t.linked_ref === 'pay_9')).toHaveLength(1)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([expect.objectContaining({ account_id: ACC, transaction_type: 'DEBIT', amount: 50000 })])
    expect(banco.saldo(ACC)).toBe(50000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0, anticipated_at: null }))
  })
})

describe('§3 estorno de AR — (b) compensa os nocionais ainda não convertidos', () => {
  it('CREDIT AR:id: DEBIT AR:id:estorno pelo líquido, na conta do crédito', async () => {
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: ACC2, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' })
    expect((await est('r1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(doAR().find((t) => t.bank_ref === 'AR:r1:estorno')).toEqual(expect.objectContaining({ account_id: ACC2, transaction_type: 'DEBIT', amount: 15000 }))
    expect(banco.saldo(ACC2)).toBe(-15000)
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it("baixa mista (12000 ligada + 3000 criada): 'permanece' compensa os 15000; a linha segue ligada", async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'CREDIT', amount: 12000, origin: 'BANCO', bank_ref: 'K1', source_text: 'PIX', linked_ref: 'AR:r1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 3000, bank_ref: 'AR:r1' })
    await est('r1', { dinheiro: 'permanece' })
    expect(banco.tx_('L')!.linked_ref).toBe('AR:r1')
    expect(banco.saldo(ACC)).toBe(85000)
  })

  it('crédito da antecipação (#11/E9): estornar antecipada = compensar a antecipação; anticipated_at volta a null', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 14000, total_amount: 15000, anticipated_at: new Date('2026-10-20T12:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 14000, bank_ref: 'AR:r1:anticipation' })
    expect((await est('r1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(86000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0, anticipated_at: null }))
  })

  it('#17: quitada com received_amount nulo (agrupada conferida) e CREDIT AR:id: aceita e compensa (antes 400)', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: null, total_amount: 30000, grouped_into_id: 'G' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 30000, bank_ref: 'AR:r1' })
    expect((await est('r1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(70000)
  })

  it('PENDENTE com recebimento parcial (crédito próprio 5000): compensa e zera', async () => {
    banco.ar({ id: 'r1', status: 'PENDENTE', account_id: ACC, received_amount: 5000, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 5000, bank_ref: 'AR:r1' })
    expect((await est('r1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(95000)
    expect(ar().received_amount).toBe(0)
  })

  it('m7: já estornada (CREDIT − DEBIT :estorno = 0, PENDENTE/0): 400 "nada a estornar", nada gravado', async () => {
    banco.ar({ id: 'r1', status: 'PENDENTE', account_id: ACC, received_amount: 0, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 15000, bank_ref: 'AR:r1:estorno' })
    const { status, j } = await est()
    expect(status).toBe(400)
    expect(j.error).toBe('nada a estornar')
    expect(doAR()).toHaveLength(2)
  })
})

describe('§3 estorno de AR — (c) legado e (d) só status', () => {
  it('#13: recebida antes de 22/05 (lançamento sem bank_ref): compensa received_amount na conta da AR como o código antigo', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 300000, total_amount: 300000, updated_at: new Date('2026-05-05T15:00:00Z'), created_at: new Date('2026-05-01T12:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 300000, bank_ref: null, description: 'Recebimento: Aluguel maio' })
    expect((await est()).status).toBe(200)
    expect(doAR()).toEqual([expect.objectContaining({ bank_ref: 'AR:r1:estorno', transaction_type: 'DEBIT', amount: 300000, account_id: ACC })])
    expect(banco.saldo(ACC)).toBe(-200000)
  })

  it("quitada depois de 22/05 só com o crédito do adquirente (não convertido), conta com extrato: pergunta; 'devolvido' → só status", async () => {
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') })
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: new Date('2026-06-10T15:00:00Z') })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1' })
    banco.transacao({ id: 'acq', account_id: ACC, transaction_type: 'CREDIT', amount: 14500, bank_ref: 'acquirer:rede:NSU1' })
    expect((await est()).status).toBe(409)
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(doAR()).toEqual([])
    expect(banco.tx_('acq')).toEqual(expect.objectContaining({ bank_ref: 'acquirer:rede:NSU1', origin: null }))
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar().status).toBe('PENDENTE')
  })

  it('quitada sem valor nem lançamento: 400 "nada a estornar"', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 0, total_amount: 15000 })
    expect((await est()).j.error).toBe('nada a estornar')
    expect(ar().status).toBe('RECEBIDO')
  })

  it('CANCELADO continua recusado (400)', async () => {
    banco.ar({ id: 'r1', status: 'CANCELADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    expect((await est()).status).toBe(400)
  })
})

describe('§3/§7/§10: travas, releitura e transação', () => {
  it('trava a conta (accounts) ANTES da AR e decide pela releitura do tx (antecipação comitada enquanto esperava — #11)', async () => {
    banco.ar({ id: 'r1', status: 'PENDENTE', account_id: ACC, received_amount: 1000, total_amount: 300000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 1000, bank_ref: 'AR:r1' })
    // Antecipar comita enquanto o estorno espera a trava da AR.
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts_receivable') return
      banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 280000, bank_ref: 'AR:r1:anticipation' })
      banco.tabelas.account.find((a) => a.id === ACC)!.current_balance += 280000
      Object.assign(ar(), { status: 'RECEBIDO', received_amount: 280000, anticipated_at: new Date() })
      banco.aoTravar(null)
    })
    expect((await est('r1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(banco.travas.map((t) => t.tabela)).toEqual(['accounts', 'accounts_receivable'])
    // F9-A: compensa exatamente o recebido relido (280000), alocado nos créditos próprios (parcial 1000 + 279000 da antecipação).
    expect(banco.saldo(ACC)).toBe(100000 + 280000 - 280000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0, anticipated_at: null }))
    expect(banco.prismaDentroDaTx()).toEqual([])
    const escritas = banco.log.filter((o) => ['create', 'update', 'updateMany', 'delete'].includes(o.op))
    expect(escritas.every((o) => o.cliente === 'tx' && o.seq > banco.travas[1].seq)).toBe(true)
  })

  it('linha ligada nova numa conta que não foi travada (apareceu depois da leitura): 409 "conta alterada — repita", nada gravado', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' })
    banco.aoTravar(({ tabela }) => {
      if (tabela === 'accounts_receivable') banco.transacao({ account_id: ACC2, transaction_type: 'CREDIT', amount: 500, origin: 'BANCO', bank_ref: 'K9', source_text: 'PIX', linked_ref: 'AR:r1' })
    })
    const { status, j } = await est('r1', { dinheiro: 'permanece' })
    expect(status).toBe(409)
    expect(j.error).toBe('conta alterada — repita')
    expect(banco.transacoes.at(-1)!.desfeita).toBe(true)
    expect(ar().status).toBe('RECEBIDO')
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('AR excluída enquanto esperava a trava: 404', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_receivable') ar().deleted_at = new Date() })
    expect((await est()).status).toBe(404)
  })
})

describe('cenários dos achados (fluxo completo, saldo do ERP = banco)', () => {
  const CORTE = '2026-10-29'
  const DATA = '2026-11-02'
  const prepararLivro = () => {
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, bank_ref: `AJUSTE:${ACC}:${CORTE}`, origin: 'AJUSTE', transaction_date: dia(CORTE) })
    banco.ar({ id: 'ar1', status: 'PENDENTE', account_id: ACC, total_amount: 50000, description: 'OS 1' })
    banco.ar({ id: 'ar2', status: 'PENDENTE', account_id: ACC, total_amount: 50000, description: 'OS 2' })
  }
  const receberAR = (id: string) => receber(new NextRequest('http://x/api', json({ received_amount: 50000, account_id: ACC, received_at: DATA })), { params: { id } })
  const linha = (links?: string[]) => lancarLinhas(new NextRequest('http://x/api', json({
    account_id: ACC, corte: CORTE,
    linhas: [{ chave: `ITAU:${DATA}|PIX RECEBIDO|+50000|1`, data: DATA, descricao: 'PIX RECEBIDO', valor_centavos: 50000, ...(links ? { links } : {}) }],
  })))

  it("#1: Receber AR#1 → livro LIGA (links) → estornar AR#1 'permanece' → Receber AR#2: um PIX de 500 conta uma vez", async () => {
    prepararLivro()
    expect((await receberAR('ar1')).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(150000)
    expect((await (await linha(['AR:ar1'])).json()).data.resultados[0].acao).toBe('LIGAR')
    expect((await est('ar1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(100000)
    const r2 = await (await receberAR('ar2')).json()
    expect(r2.data.ligada).toBe(false) // a linha segue ligada à AR#1 (compensada pelo :estorno)
    expect(banco.saldo(ACC)).toBe(150000) // banco: 100000 + 50000
  })

  it("#12: idem pelo órfão (sem links); e na MESMA AR: estornar 'permanece' e receber de novo também fecha", async () => {
    prepararLivro()
    await receberAR('ar1')
    expect((await (await linha()).json()).data.resultados[0]).toEqual(expect.objectContaining({ acao: 'LIGAR', origem: 'orfao' }))
    await est('ar1', { dinheiro: 'permanece' })
    const r = await (await receberAR('ar1')).json()
    expect(r.data.ligada).toBe(false)
    expect(banco.saldo(ACC)).toBe(150000)
  })

  it('estorno ANTES do extrato e Receber de novo: o livro liga o crédito novo (não o estornado) — sem 2x', async () => {
    prepararLivro()
    await receberAR('ar1')
    await est('ar1', { dinheiro: 'permanece' })
    expect(banco.saldo(ACC)).toBe(100000)
    await receberAR('ar1')
    expect((await (await linha()).json()).data.resultados[0]).toEqual(expect.objectContaining({ acao: 'LIGAR', origem: 'orfao' }))
    expect(banco.saldo(ACC)).toBe(150000)
  })
})

describe('F2-E (#5, m4): legado detectado pela própria transação (AR)', () => {
  it('AR recebida em 15/05 (CREDIT sem bank_ref) e editada em 01/11: compensa o received_amount', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 40000, total_amount: 40000, description: 'OS 1', updated_at: new Date('2026-11-01T15:00:00Z'), created_at: new Date('2026-05-01T12:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 40000, bank_ref: null, description: 'Recebimento: OS 1', created_at: new Date('2026-05-15T15:00:00Z') })
    expect((await est()).status).toBe(200)
    expect(doAR()).toEqual([expect.objectContaining({ bank_ref: 'AR:r1:estorno', transaction_type: 'DEBIT', amount: 40000 })])
    expect(banco.saldo(ACC)).toBe(60000)
  })

  it('crédito "Recebimento: OS 1" de outra conta, de linha do banco, de outro valor ou de depois de 22/05 não conta como legado: (d)', async () => {
    // Fix 4 (F4-A, #8): AR antiga e descrição no formato certo — só conta/origem/valor/data separam do positivo acima.
    for (const extra of [{ account_id: ACC2 }, { origin: 'BANCO' }, { amount: 39000 }, { created_at: new Date('2026-06-10T15:00:00Z') }]) {
      banco.reset(); banco.categoriasPadrao(); banco.conta({ id: ACC, current_balance: 100000 }); banco.conta({ id: ACC2, current_balance: 0 })
      banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 40000, total_amount: 40000, description: 'OS 1', updated_at: new Date('2026-11-01T15:00:00Z'), created_at: new Date('2026-05-01T12:00:00Z') })
      banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 40000, bank_ref: null, description: 'Recebimento: OS 1', created_at: new Date('2026-05-15T15:00:00Z'), ...extra })
      expect((await est()).status, JSON.stringify(extra)).toBe(200)
      expect(doAR(), JSON.stringify(extra)).toEqual([])
      expect(banco.saldo(ACC)).toBe(100000)
    }
  })
})

describe("F2-G (#11) → F8-A/F8-B: o marcador antigo LIGADA é dinheiro; 'permanece' o compensa como produção, salvo se anterior ao ajuste", () => {
  it("crédito AR:id com source_text LIGADA:… (origin null), conta sem ajuste: pergunta; 'permanece' → DEBIT na conta", async () => {
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1', source_text: 'LIGADA:ITAU:k' })
    expect((await est()).status).toBe(409)
    expect((await est('r1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([expect.objectContaining({ amount: 15000, account_id: ACC })])
    expect(banco.saldo(ACC)).toBe(85000)
  })

  it("F9-A (corrige o F8-B no estorno): LIGADA anterior ao ajuste + crédito próprio posterior → 'permanece' compensa o recebido inteiro, o posterior primeiro", async () => {
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, bank_ref: `AJUSTE:${ACC}:2026-10-29`, origin: 'AJUSTE', created_at: new Date('2026-10-30T12:00:00Z') })
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 12000, bank_ref: 'AR:r1', source_text: 'LIGADA:k1', created_at: new Date('2026-10-01T12:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 3000, bank_ref: 'AR:r1', created_at: new Date('2026-11-01T12:00:00Z') })
    await est('r1', { dinheiro: 'permanece' })
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([expect.objectContaining({ amount: 15000 })])
    expect(banco.saldo(ACC)).toBe(85000)
  })

  it('m21: a tx do estorno usa maxWait 10s e timeout 20s', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    await est()
    expect(banco.transacoes.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }])
  })
})

describe('F3-A (#1, #6, #8, #10, m10): legado (c) só sem dinheiro externo, só em conta antiga e só com a transação legada certa', () => {
  const MAIO = new Date('2026-05-10T15:00:00Z')
  const RECENTE = new Date('2026-10-30T15:00:00Z')
  // Recebimento manual antigo de OUTRA AR com o mesmo valor, na mesma conta (valores de OS se repetem).
  const creditoLegado = (extra: Record<string, unknown> = {}) =>
    banco.transacao({ id: 'leg', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: null, description: 'Recebimento: OS 61000', created_at: MAIO, ...extra })
  const semEstorno = () => {
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar().status).toBe('PENDENTE')
  }

  it('#8: AR paga por Asaas (crédito pay_x vivo) + crédito legado do mesmo valor na conta → (d) só status, saldo intocado', async () => {
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: RECENTE })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 14550, bank_ref: 'pay_x' })
    creditoLegado()
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') }) // conta com extrato: 'devolvido' não lança
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    semEstorno()
  })

  it('#6: AR paga por CNAB (cnab:<n> vivo) + crédito manual antigo do mesmo valor → (d)', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: RECENTE, pix_code: JSON.stringify({ nossoNumero: '123' }) })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'cnab:123' })
    creditoLegado()
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') }) // conta com extrato: 'devolvido' não lança
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    semEstorno()
  })

  it('(ii) conta ANTIGA com dinheiro externo (linha BANCO convertida do adquirente) + crédito legado → (d)', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: RECENTE, created_at: new Date('2026-05-01T12:00:00Z') })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 14250, origin: 'BANCO', bank_ref: 'ITAU:k', linked_ref: 'acquirer:rede:NSU1' })
    creditoLegado()
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') }) // conta com extrato: 'devolvido' não lança
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    semEstorno()
  })

  it('(iii) AR criada depois de 22/05, sem dinheiro externo, + crédito antigo do mesmo valor e da MESMA descrição → (d)', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, description: 'OS 61000', updated_at: RECENTE, created_at: new Date('2026-06-01T12:00:00Z') })
    creditoLegado()
    expect((await est()).status).toBe(200)
    semEstorno()
  })

  it('(iv) conta antiga, mas a transação antiga não é um "Recebimento: …" (ou é de outro tipo / tem bank_ref) → (d)', async () => {
    for (const extra of [{ description: 'PIX qualquer' }, { transaction_type: 'DEBIT' }, { bank_ref: 'AR:outra' }]) {
      banco.reset(); banco.categoriasPadrao(); banco.conta({ id: ACC, current_balance: 100000 })
      banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, description: 'OS 61000', updated_at: RECENTE, created_at: new Date('2026-05-01T12:00:00Z') })
      creditoLegado(extra)
      expect((await est()).status).toBe(200)
      semEstorno()
    }
  })

  it('conta antiga sem dinheiro externo e com a transação legada "Recebimento: <descrição dela>" → (c) compensa', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, description: 'OS 1', updated_at: RECENTE, created_at: new Date('2026-05-01T12:00:00Z') })
    creditoLegado({ description: 'Recebimento: OS 1' })
    expect((await est()).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([expect.objectContaining({ amount: 15000, account_id: ACC })])
    expect(banco.saldo(ACC)).toBe(85000)
  })
})

describe('F4-A (#1, m12): legado (c) só com a transação DESTA AR e sem pagamento por fora', () => {
  const MAIO = new Date('2026-05-10T15:00:00Z')
  const RECENTE = new Date('2026-11-01T15:00:00Z')
  const arAntiga = (extra: Record<string, unknown> = {}) => banco.ar({
    id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 35000, total_amount: 35000, description: 'OS 60100',
    updated_at: RECENTE, created_at: new Date('2026-05-15T12:00:00Z'), ...extra,
  })
  const legado = (description: string) =>
    banco.transacao({ id: 'leg', account_id: ACC, transaction_type: 'CREDIT', amount: 35000, bank_ref: null, description, created_at: MAIO })
  const soStatus = () => {
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0 }))
  }

  it('#1: AR de 15/05 quitada por cartão Asaas CONFIRMED (sem crédito ainda) + "Recebimento: OS-outra" de mesmo valor → (d)', async () => {
    arAntiga()
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'CONFIRMED' })
    legado('Recebimento: OS 59999')
    expect((await est()).status).toBe(200)
    soStatus()
  })

  it('"Recebimento: OS-outra" de mesmo valor, sem pagamento nenhum (balcão / reconcile sem crédito) → (d)', async () => {
    arAntiga()
    legado('Recebimento: OS 59999')
    expect((await est()).status).toBe(200)
    soStatus()
  })

  it('a transação exata desta AR, mas com Payment Asaas CONFIRMED/RECEIVED ou venda do adquirente → (d) (o dinheiro vem/virá por fora)', async () => {
    for (const p of [{ provider: 'asaas', status: 'CONFIRMED' }, { provider: 'asaas', status: 'RECEIVED' }, { provider: 'rede', status: 'CONFIRMED' }]) {
      banco.reset(); banco.categoriasPadrao(); banco.conta({ id: ACC, current_balance: 100000 })
      arAntiga()
      banco.pagamento({ receivable_id: 'r1', external_id: 'x1', ...p })
      legado('Recebimento: OS 60100')
      expect((await est()).status, JSON.stringify(p)).toBe(200)
      soStatus()
    }
  })

  it('ramo updated_at antigo também exige ausência de pagamento por fora → (d)', async () => {
    arAntiga({ updated_at: new Date('2026-05-16T12:00:00Z') })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'CONFIRMED' })
    expect((await est()).status).toBe(200)
    soStatus()
  })

  it('cobrança Asaas não paga (PENDING) não impede: transação exata "Recebimento: OS 60100" → (c)', async () => {
    arAntiga()
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'PENDING' })
    legado('Recebimento: OS 60100')
    expect((await est()).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([expect.objectContaining({ amount: 35000, account_id: ACC })])
    expect(banco.saldo(ACC)).toBe(65000)
  })

  it('m12: AR antiga com crédito nocional externo vivo (cnab:) + transação exata → (d) pela (ii)', async () => {
    arAntiga({ pix_code: JSON.stringify({ nossoNumero: '777' }) })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 35000, bank_ref: 'cnab:777', created_at: new Date('2026-05-16T12:00:00Z') })
    legado('Recebimento: OS 60100')
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') }) // conta com extrato: 'devolvido' não lança
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })
})

describe('F8-A (§0, #1, #2, #7): o estorno PERGUNTA se o dinheiro voltou para o cliente ou continua no banco', () => {
  const PERGUNTA = 'O dinheiro deste recebimento voltou para o cliente, ou continua no banco (lançado na conta errada/por engano)?'
  const CORTE = '2026-10-29', DATA = '2026-11-02'
  const prepararLivro = () => {
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, bank_ref: `AJUSTE:${ACC}:${CORTE}`, origin: 'AJUSTE', transaction_date: dia(CORTE) })
    banco.ar({ id: 'ar1', status: 'PENDENTE', account_id: ACC, total_amount: 50000, description: 'OS 1' })
    banco.ar({ id: 'ar2', status: 'PENDENTE', account_id: ACC, total_amount: 50000, description: 'OS 2' })
  }
  const receberEm = (id: string, data: string, valor = 50000) =>
    receber(new NextRequest('http://x/api', json({ received_amount: valor, account_id: ACC, received_at: data })), { params: { id } })
  const linha = (links: string[], chave = `ITAU:${DATA}|PIX RECEBIDO|+50000|1`, valor = 50000) => lancarLinhas(new NextRequest('http://x/api', json({
    account_id: ACC, corte: CORTE, linhas: [{ chave, data: DATA, descricao: 'PIX RECEBIDO', valor_centavos: valor, links }],
  })))

  it('com dinheiro e sem `dinheiro` → 409 ESTORNO_PERGUNTA com os lançamentos; nada gravado', async () => {
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, origin: 'BANCO', bank_ref: 'K1', source_text: 'PIX', linked_ref: 'AR:r1', transaction_date: dia('2026-11-01') })
    const { status, j } = await est()
    expect(status).toBe(409)
    expect(j).toEqual(expect.objectContaining({ code: 'ESTORNO_PERGUNTA', error: PERGUNTA, lancados: [expect.objectContaining({ valor_centavos: 15000, data: '2026-11-01' })] }))
    expect(ar().status).toBe('LIQUIDADO')
    expect(banco.tx_('L')!.linked_ref).toBe('AR:r1')
    expect(doAR()).toEqual([])
  })

  it("'devolvido' em conta com extrato (AJUSTE) → só status: nenhuma compensação nem desligamento (a saída da devolução vem pelo extrato)", async () => {
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') })
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, origin: 'BANCO', bank_ref: 'K1', source_text: 'PIX', linked_ref: 'AR:r1' })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('L')!.linked_ref).toBe('AR:r1')
    expect(doAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0 }))
  })

  it("#1: AR convertida → estorno 'permanece' (DEBIT na conta da linha, linha segue ligada) → Receber de OUTRA AR fora da janela → saldo = banco", async () => {
    prepararLivro()
    await receberEm('ar1', DATA)
    expect((await (await linha(['AR:ar1'])).json()).data.resultados[0].acao).toBe('LIGAR')
    expect(banco.saldo(ACC)).toBe(150000)
    expect((await est('ar1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.linked_ref === 'AR:ar1')).toHaveLength(1)
    expect(doAR('ar1').filter((t) => t.bank_ref === 'AR:ar1:estorno')).toEqual([expect.objectContaining({ account_id: ACC, amount: 50000, transaction_type: 'DEBIT' })])
    expect(banco.saldo(ACC)).toBe(100000)
    const r = await (await receberEm('ar2', '2026-11-22')).json()
    expect(r.data.ligada).toBe(false)
    expect(banco.saldo(ACC)).toBe(150000) // banco: 100000 + o PIX de 500
  })

  it("depois do 'permanece', o Receber da MESMA AR lança sem perguntar (o :estorno desconta a linha ligada)", async () => {
    prepararLivro()
    await receberEm('ar1', DATA)
    await linha(['AR:ar1'])
    await est('ar1', { dinheiro: 'permanece' })
    const res = await receberEm('ar1', '2026-11-22')
    expect(res.status).toBe(200)
    expect(banco.saldo(ACC)).toBe(150000)
  })

  it("#2: match errado da maquininha → estorno 'permanece' debita o recebido (9700 do adquirente + 300 na conta da AR) → Receber da OS certa → saldo = banco", async () => {
    banco.ar({ id: 'a1', status: 'RECEBIDO', account_id: ACC, received_amount: 10000, total_amount: 10000 })
    banco.ar({ id: 'b', status: 'PENDENTE', account_id: ACC, total_amount: 10000 })
    banco.pagamento({ receivable_id: 'a1', provider: 'rede', external_id: 'NSU1', status: 'RECEIVED' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'acquirer:rede:NSU1' })
    banco.tabelas.account[0].current_balance = 109700
    expect((await est('a1')).status).toBe(409)
    expect((await est('a1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(doAR('a1').filter((t) => t.bank_ref === 'AR:a1:estorno')).toEqual([expect.objectContaining({ account_id: ACC, amount: 10000 })])
    await receber(new NextRequest('http://x/api', json({ received_amount: 10000, account_id: ACC, received_at: DATA })), { params: { id: 'b' } })
    expect(banco.saldo(ACC)).toBe(109700) // banco: 100000 + 9700 (o líquido da venda)
  })

  it("#7: duas linhas (100 + 100) ligadas → estorno 'permanece' → Receber pelo total → saldo = banco", async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 20000, total_amount: 20000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 10000, origin: 'BANCO', bank_ref: 'K1', source_text: 'PIX 1', linked_ref: 'AR:r1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 10000, origin: 'BANCO', bank_ref: 'K2', source_text: 'PIX 2', linked_ref: 'AR:r1' })
    banco.tabelas.account[0].current_balance = 120000
    expect((await est('r1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([expect.objectContaining({ amount: 20000 })])
    await receber(new NextRequest('http://x/api', json({ received_amount: 20000, account_id: ACC, received_at: DATA })), { params: { id: 'r1' } })
    expect(banco.saldo(ACC)).toBe(120000) // banco: 100000 + 200
  })

  it("estorno de produção que anulou parte do nocional: a pergunta mostra o vivo; 'permanece' compensa exatamente o recebido (F9-A)", async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 10000, total_amount: 10000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1', status: 'RECEIVED' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'acquirer:rede:NSU1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 10000, bank_ref: 'AR:r1' })
    // estorno antigo (produção) pelo received_amount: anula os 9700 do adquirente e 300 do nocional
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'AR:r1:estorno' })
    const { j } = await est()
    expect(j.lancados.map((l: { valor_centavos: number }) => l.valor_centavos)).toEqual([9700])
    expect((await est('r1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno').map((t) => t.amount)).toEqual([10000, 10000])
    expect(banco.saldo(ACC)).toBe(100000 - 10000)
  })

  it('o :estorno só anula dinheiro criado ATÉ ele: o crédito lançado depois de um estorno de produção conta inteiro', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 10000, total_amount: 10000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1', status: 'RECEIVED' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'acquirer:rede:NSU1' })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 10000, bank_ref: 'AR:r1:estorno' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 10000, bank_ref: 'AR:r1' })
    const { status, j } = await est()
    expect(status).toBe(409)
    expect(j.lancados.map((l: { valor_centavos: number }) => l.valor_centavos)).toEqual([10000])
  })

  it("'permanece' com reembolso parcial do Asaas: aloca o vivo (crédito − reembolso) na conta do pay_ e a sobra do recebido na conta da AR", async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 10000, total_amount: 10000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED' })
    banco.transacao({ account_id: ACC2, transaction_type: 'CREDIT', amount: 10000, bank_ref: 'pay_x' })
    banco.transacao({ account_id: ACC2, transaction_type: 'DEBIT', amount: 3000, bank_ref: 'pay_x-refund' })
    expect((await est('r1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno').map((t) => [t.account_id, t.amount]).sort()).toEqual([[ACC, 3000], [ACC2, 7000]].sort())
  })

  it('sem dinheiro na conta → só status, sem pergunta', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: new Date('2026-07-01T00:00:00Z') })
    expect((await est()).status).toBe(200)
    expect(ar().status).toBe('PENDENTE')
  })

  it('`dinheiro` inválido → 400', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    expect((await est('r1', { dinheiro: 'talvez' })).status).toBe(400)
  })
})

describe('F9-A: \'permanece\' compensa exatamente o received_amount — posterior ao ajuste primeiro, depois o anterior', () => {
  const CORTE = '2026-10-29'
  const ajuste = (conta: string) => banco.transacao({ account_id: conta, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${conta}:${CORTE}`, created_at: new Date('2026-10-30T10:00:00Z'), transaction_date: dia(CORTE) })
  const receberEm = (id: string, conta: string) =>
    receber(new NextRequest('http://x/api', json({ received_amount: 50000, account_id: conta, received_at: '2026-11-03' })), { params: { id } })

  it('só nocional ANTERIOR ao ajuste (Receber 28/10, ajuste 30/10) → compensa X → Receber de outra AR X → saldo = banco', async () => {
    banco.tabelas.account[0].current_balance = 150000 // banco: 100000 + o PIX de 500 (já no ajuste)
    // a AR aponta para OUTRA conta (ACC2): a compensação vai na conta do nocional, não na da AR
    banco.ar({ id: 'ar1', status: 'RECEBIDO', account_id: ACC2, received_amount: 50000, total_amount: 50000, description: 'OS 1' })
    banco.ar({ id: 'ar2', status: 'PENDENTE', account_id: ACC, total_amount: 50000, description: 'OS 2' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:ar1', created_at: new Date('2026-10-28T15:00:00Z') })
    ajuste(ACC)
    expect((await est('ar1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(doAR('ar1').filter((t) => t.bank_ref === 'AR:ar1:estorno')).toEqual([expect.objectContaining({ account_id: ACC, amount: 50000 })])
    expect((await receberEm('ar2', ACC)).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(150000)
  })

  it('linha L posterior + nocional N anterior ao ajuste, na mesma AR de X → compensa X UMA vez, na conta de L → Receber de outra AR → saldo = banco', async () => {
    banco.tabelas.account[1].current_balance = 50000 // ACC2 (banco): a linha L de 500
    banco.ar({ id: 'ar1', status: 'LIQUIDADO', account_id: ACC, received_amount: 50000, total_amount: 50000, description: 'OS 1' })
    banco.ar({ id: 'ar2', status: 'PENDENTE', account_id: ACC2, total_amount: 50000, description: 'OS 2' })
    banco.transacao({ id: 'N', account_id: ACC, transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:ar1', created_at: new Date('2026-10-28T15:00:00Z') })
    ajuste(ACC)
    ajuste(ACC2)
    banco.transacao({ id: 'L', account_id: ACC2, transaction_type: 'CREDIT', amount: 50000, origin: 'BANCO', bank_ref: 'K1', source_text: 'PIX', linked_ref: 'AR:ar1' })
    expect((await est('ar1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(doAR('ar1').filter((t) => t.bank_ref === 'AR:ar1:estorno')).toEqual([expect.objectContaining({ account_id: ACC2, amount: 50000 })])
    expect(banco.saldo(ACC)).toBe(100000)
    expect((await receberEm('ar2', ACC2)).status).toBe(200)
    expect(banco.saldo(ACC2)).toBe(50000)
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('recebido maior que o dinheiro (taxa do adquirente): o que sobra sem lançamento vai para a conta da AR, como produção', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 10000, total_amount: 10000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1', status: 'RECEIVED' })
    banco.transacao({ account_id: ACC2, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'acquirer:rede:NSU1' })
    expect((await est('r1', { dinheiro: 'permanece' })).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno').map((t) => [t.account_id, t.amount]).sort()).toEqual([[ACC, 300], [ACC2, 9700]].sort())
  })
})

describe('F9-B: \'devolvido\' compensa só em conta SEM extrato (sem AJUSTE:<conta>:)', () => {
  const CAIXA = '33333333-3333-4333-8333-333333333333'
  it('AR recebida no Caixa → \'devolvido\' → DEBIT :estorno no Caixa (o saldo do Caixa volta)', async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 15000 })
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: CAIXA, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: CAIXA, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([expect.objectContaining({ account_id: CAIXA, amount: 15000, transaction_type: 'DEBIT' })])
    expect(banco.saldo(CAIXA)).toBe(0)
  })

  it('AR recebida no Itaú (conta com extrato: AJUSTE) → \'devolvido\' → nada lançado', async () => {
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') })
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('dinheiro no Caixa e no Itaú (com extrato) → \'devolvido\' compensa só o do Caixa, sem sobra para a conta da AR', async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 5000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') })
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: CAIXA, transaction_type: 'CREDIT', amount: 5000, bank_ref: 'AR:r1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 10000, bank_ref: 'AR:r1' })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([expect.objectContaining({ account_id: CAIXA, amount: 5000 })])
  })
})

