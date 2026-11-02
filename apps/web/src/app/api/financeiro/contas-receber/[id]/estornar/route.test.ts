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
const est = async (id = 'r1') => {
  const res = await estornar(new NextRequest('http://x/api', json({})), { params: { id } })
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

describe('§3 estorno de AR — (a) DESLIGA linhas do banco', () => {
  it('linha ligada pela baixa (linked_ref AR:id): desliga — categoria da regra/fallback, texto do banco; sem DEBIT nem saldo', async () => {
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, origin: 'BANCO', bank_ref: 'K1', source_text: 'PIX RECEBIDO FULANO', linked_ref: 'AR:r1', category_id: 'cat:Venda de Servicos', description: 'LIQUIDACAO: OS 1 · banco: PIX RECEBIDO FULANO' })
    const { status } = await est()
    expect(status).toBe(200)
    expect(banco.tx_('L')).toEqual(expect.objectContaining({ linked_ref: null, category_id: 'cat:Receita a identificar', description: 'PIX RECEBIDO FULANO', origin: 'BANCO' }))
    expect(doAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0, reconciled: false }))
  })

  it('ao desligar, a categoria vem da regra quando alguma casa (REND PAGO APLIC → Rendimentos)', async () => {
    banco.regra({ pattern: 'REND PAGO APLIC', direction: 'IN', category_id: 'cat:Rendimentos', priority: 10 })
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, origin: 'BANCO', bank_ref: 'K1', source_text: 'REND PAGO APLIC AUT', linked_ref: 'AR:r1', category_id: 'cat:Venda de Servicos' })
    await est()
    expect(banco.tx_('L')!.category_id).toBe('cat:Rendimentos')
  })

  it('F2-B (#1): linhas convertidas de ref EXTERNA (adquirente, Asaas, CNAB, antecipação) ficam ligadas — continuam sendo o dinheiro daquele evento', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 40000, total_amount: 40000, pix_code: JSON.stringify({ nossoNumero: '777' }), anticipated_at: new Date('2026-10-20T12:00:00Z') })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1' })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_9' })
    for (const [id, ref] of [['A', 'acquirer:rede:NSU1'], ['B', 'pay_9'], ['C', 'cnab:777'], ['D', 'AR:r1:anticipation']]) {
      banco.transacao({ id, account_id: ACC, transaction_type: 'CREDIT', amount: 10000, origin: 'BANCO', bank_ref: `K${id}`, source_text: `TXT ${id}`, linked_ref: ref })
    }
    const { status } = await est()
    expect(status).toBe(200)
    for (const [id, ref] of [['A', 'acquirer:rede:NSU1'], ['B', 'pay_9'], ['C', 'cnab:777'], ['D', 'AR:r1:anticipation']]) {
      expect(banco.tx_(id)!.linked_ref).toBe(ref)
    }
    // o dedupe dos produtores (ondeRef) continua achando o dinheiro do pay_9
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'pay_9' || t.linked_ref === 'pay_9')).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0, anticipated_at: null }))
  })

  it('F2-B: linha ligada à ref própria AR:id é desligada; a de ref externa da mesma AR fica', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 25000, total_amount: 25000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x' })
    banco.transacao({ id: 'P', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, origin: 'BANCO', bank_ref: 'KP', source_text: 'PIX', linked_ref: 'AR:r1' })
    banco.transacao({ id: 'X', account_id: ACC, transaction_type: 'CREDIT', amount: 10000, origin: 'BANCO', bank_ref: 'KX', source_text: 'ASAAS', linked_ref: 'pay_x' })
    expect((await est()).status).toBe(200)
    expect(banco.tx_('P')!.linked_ref).toBeNull()
    expect(banco.tx_('X')!.linked_ref).toBe('pay_x')
  })
})

describe('§3 estorno de AR — (b) compensa os nocionais ainda não convertidos', () => {
  it('CREDIT AR:id: DEBIT AR:id:estorno pelo líquido, na conta do crédito', async () => {
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: ACC2, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' })
    expect((await est()).status).toBe(200)
    expect(doAR().find((t) => t.bank_ref === 'AR:r1:estorno')).toEqual(expect.objectContaining({ account_id: ACC2, transaction_type: 'DEBIT', amount: 15000 }))
    expect(banco.saldo(ACC2)).toBe(-15000)
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('baixa mista (12000 ligada + 3000 criada): desliga e compensa só os 3000', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'CREDIT', amount: 12000, origin: 'BANCO', bank_ref: 'K1', source_text: 'PIX', linked_ref: 'AR:r1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 3000, bank_ref: 'AR:r1' })
    await est()
    expect(banco.tx_('L')!.linked_ref).toBeNull()
    expect(banco.saldo(ACC)).toBe(97000)
  })

  it('crédito da antecipação (#11/E9): estornar antecipada = compensar a antecipação; anticipated_at volta a null', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 14000, total_amount: 15000, anticipated_at: new Date('2026-10-20T12:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 14000, bank_ref: 'AR:r1:anticipation' })
    expect((await est()).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(86000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0, anticipated_at: null }))
  })

  it('#17: quitada com received_amount nulo (agrupada conferida) e CREDIT AR:id: aceita e compensa (antes 400)', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: null, total_amount: 30000, grouped_into_id: 'G' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 30000, bank_ref: 'AR:r1' })
    expect((await est()).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(70000)
  })

  it('PENDENTE com recebimento parcial (crédito próprio 5000): compensa e zera', async () => {
    banco.ar({ id: 'r1', status: 'PENDENTE', account_id: ACC, received_amount: 5000, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 5000, bank_ref: 'AR:r1' })
    expect((await est()).status).toBe(200)
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

  it('quitada depois de 22/05 sem nenhum lançamento próprio (ex.: crédito do adquirente não convertido): só status', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: new Date('2026-06-10T15:00:00Z') })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1' })
    banco.transacao({ id: 'acq', account_id: ACC, transaction_type: 'CREDIT', amount: 14500, bank_ref: 'acquirer:rede:NSU1' })
    expect((await est()).status).toBe(200)
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
    expect((await est()).status).toBe(200)
    expect(banco.travas.map((t) => t.tabela)).toEqual(['accounts', 'accounts_receivable'])
    // +280000 da antecipação (comitada no meio) − 281000 (tudo o que o ERP creditou: parcial 1000 + antecipação).
    expect(banco.saldo(ACC)).toBe(100000 + 280000 - 281000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0, anticipated_at: null }))
    expect(banco.prismaDentroDaTx()).toEqual([])
    const escritas = banco.log.filter((o) => ['create', 'update', 'updateMany', 'delete'].includes(o.op))
    expect(escritas.every((o) => o.cliente === 'tx' && o.seq > banco.travas[1].seq)).toBe(true)
  })

  it('lançamento novo numa conta que não foi travada (apareceu depois da leitura): 409 "conta alterada — repita", nada gravado', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' })
    banco.aoTravar(({ tabela }) => {
      if (tabela === 'accounts_receivable') banco.transacao({ account_id: ACC2, transaction_type: 'CREDIT', amount: 500, bank_ref: 'AR:r1' })
    })
    const { status, j } = await est()
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

  it('#1: Receber AR#1 → livro LIGA (links) → estornar AR#1 → Receber AR#2: um PIX de 500 conta uma vez', async () => {
    prepararLivro()
    expect((await receberAR('ar1')).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(150000)
    expect((await (await linha(['AR:ar1'])).json()).data.resultados[0].acao).toBe('LIGAR')
    expect((await est('ar1')).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(150000)
    const r2 = await (await receberAR('ar2')).json()
    expect(r2.data.ligada).toBe(true)
    expect(banco.saldo(ACC)).toBe(150000) // banco: 100000 + 50000
    expect(banco.tabelas.transaction.filter((t) => t.transaction_type === 'CREDIT' && t.amount === 50000)).toHaveLength(1)
  })

  it('#12: idem pelo órfão (sem links); e na MESMA AR: estornar e receber de novo também fecha', async () => {
    prepararLivro()
    await receberAR('ar1')
    expect((await (await linha()).json()).data.resultados[0]).toEqual(expect.objectContaining({ acao: 'LIGAR', origem: 'orfao' }))
    await est('ar1')
    const r = await (await receberAR('ar1')).json()
    expect(r.data.ligada).toBe(true)
    expect(banco.saldo(ACC)).toBe(150000)
  })

  it('estorno ANTES do extrato e Receber de novo: o livro liga o crédito novo (não o estornado) — sem 2x', async () => {
    prepararLivro()
    await receberAR('ar1')
    await est('ar1')
    expect(banco.saldo(ACC)).toBe(100000)
    await receberAR('ar1')
    expect((await (await linha()).json()).data.resultados[0]).toEqual(expect.objectContaining({ acao: 'LIGAR', origem: 'orfao' }))
    expect(banco.saldo(ACC)).toBe(150000)
  })
})

describe('F2-E (#5, m4): legado detectado pela própria transação (AR)', () => {
  it('AR recebida em 15/05 (CREDIT sem bank_ref) e editada em 01/11: compensa o received_amount', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 40000, total_amount: 40000, updated_at: new Date('2026-11-01T15:00:00Z'), created_at: new Date('2026-05-01T12:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 40000, bank_ref: null, description: 'Recebimento: OS 1', created_at: new Date('2026-05-15T15:00:00Z') })
    expect((await est()).status).toBe(200)
    expect(doAR()).toEqual([expect.objectContaining({ bank_ref: 'AR:r1:estorno', transaction_type: 'DEBIT', amount: 40000 })])
    expect(banco.saldo(ACC)).toBe(60000)
  })

  it('crédito sem bank_ref de outra conta ou de linha do banco não conta como legado: (d)', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 40000, total_amount: 40000, updated_at: new Date('2026-11-01T15:00:00Z') })
    banco.transacao({ account_id: ACC2, transaction_type: 'CREDIT', amount: 40000, bank_ref: null, created_at: new Date('2026-05-15T15:00:00Z') })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 40000, bank_ref: null, origin: 'BANCO', created_at: new Date('2026-05-15T15:00:00Z') })
    expect((await est()).status).toBe(200)
    expect(doAR()).toEqual([])
  })
})

describe('F2-G (#11): marcador antigo LIGADA (dinheiro do banco antes da migração) não é compensado', () => {
  it('crédito AR:id com source_text LIGADA:… e origin null: nada de DEBIT nem saldo', async () => {
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1', source_text: 'LIGADA:ITAU:k' })
    expect((await est()).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('LIGADA + crédito próprio sem banco: compensa só o sem banco', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 12000, bank_ref: 'AR:r1', source_text: 'LIGADA:k1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 3000, bank_ref: 'AR:r1' })
    await est()
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([expect.objectContaining({ amount: 3000 })])
    expect(banco.saldo(ACC)).toBe(97000)
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
    expect((await est()).status).toBe(200)
    semEstorno()
  })

  it('#6: AR paga por CNAB (cnab:<n> vivo) + crédito manual antigo do mesmo valor → (d)', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: RECENTE, pix_code: JSON.stringify({ nossoNumero: '123' }) })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'cnab:123' })
    creditoLegado()
    expect((await est()).status).toBe(200)
    semEstorno()
  })

  it('(ii) conta ANTIGA com dinheiro externo (linha BANCO convertida do adquirente) + crédito legado → (d)', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: RECENTE, created_at: new Date('2026-05-01T12:00:00Z') })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 14250, origin: 'BANCO', bank_ref: 'ITAU:k', linked_ref: 'acquirer:rede:NSU1' })
    creditoLegado()
    expect((await est()).status).toBe(200)
    semEstorno()
  })

  it('(iii) AR criada depois de 22/05, sem dinheiro externo, + crédito antigo do mesmo valor → (d)', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: RECENTE, created_at: new Date('2026-06-01T12:00:00Z') })
    creditoLegado()
    expect((await est()).status).toBe(200)
    semEstorno()
  })

  it('(iv) conta antiga, mas a transação antiga não é um "Recebimento: …" (ou é de outro tipo / tem bank_ref) → (d)', async () => {
    for (const extra of [{ description: 'PIX qualquer' }, { transaction_type: 'DEBIT' }, { bank_ref: 'AR:outra' }]) {
      banco.reset(); banco.categoriasPadrao(); banco.conta({ id: ACC, current_balance: 100000 })
      banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: RECENTE, created_at: new Date('2026-05-01T12:00:00Z') })
      creditoLegado(extra)
      expect((await est()).status).toBe(200)
      semEstorno()
    }
  })

  it('conta antiga sem dinheiro externo e com a transação legada "Recebimento: …" → (c) compensa', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: RECENTE, created_at: new Date('2026-05-01T12:00:00Z') })
    creditoLegado()
    expect((await est()).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([expect.objectContaining({ amount: 15000, account_id: ACC })])
    expect(banco.saldo(ACC)).toBe(85000)
  })
})
