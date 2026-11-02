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
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: 'TARIFA', source_text: 'TARIFA', transaction_date: new Date('2026-10-31T00:00:00Z') })
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
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.travas.map((t) => t.tabela)).toEqual(['accounts', 'accounts_receivable'])
    // F10-B: conta sem extrato → compensa todo o dinheiro próprio relido (parcial 1000 + antecipação comitada no meio).
    expect(banco.saldo(ACC)).toBe(100000 + 280000 - 281000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0, anticipated_at: null }))
    expect(banco.prismaDentroDaTx()).toEqual([])
    const escritas = banco.log.filter((o) => ['create', 'update', 'updateMany', 'delete'].includes(o.op))
    expect(escritas.every((o) => o.cliente === 'tx' && o.seq > banco.travas[1].seq)).toBe(true)
  })

  it('linha ligada nova numa conta que não foi travada (apareceu depois da leitura): 409 "conta alterada — repita", nada gravado', async () => {
    // contas com extrato: o 'devolvido' não compensa nada — só o sufixo escreve na linha nova
    for (const c of [ACC, ACC2]) banco.transacao({ account_id: c, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${c}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') })
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' })
    banco.aoTravar(({ tabela }) => {
      if (tabela === 'accounts_receivable') banco.transacao({ account_id: ACC2, transaction_type: 'CREDIT', amount: 500, origin: 'BANCO', bank_ref: 'K9', source_text: 'PIX', linked_ref: 'AR:r1' })
    })
    const { status, j } = await est('r1', { dinheiro: 'devolvido' })
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
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') }); banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: 'TARIFA', source_text: 'TARIFA', transaction_date: new Date('2026-10-31T00:00:00Z') }) // conta com extrato (tem linha do banco): 'devolvido' não lança o externo
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    semEstorno()
  })

  it('#6: AR paga por CNAB (cnab:<n> vivo) + crédito manual antigo do mesmo valor → (d)', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: RECENTE, pix_code: JSON.stringify({ nossoNumero: '123' }) })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'cnab:123' })
    creditoLegado()
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') }); banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: 'TARIFA', source_text: 'TARIFA', transaction_date: new Date('2026-10-31T00:00:00Z') }) // conta com extrato (tem linha do banco): 'devolvido' não lança o externo
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    semEstorno()
  })

  it('(ii) conta ANTIGA com dinheiro externo (linha BANCO convertida do adquirente) + crédito legado → (d)', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: RECENTE, created_at: new Date('2026-05-01T12:00:00Z') })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: 'NSU1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 14250, origin: 'BANCO', bank_ref: 'ITAU:k', linked_ref: 'acquirer:rede:NSU1' })
    creditoLegado()
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') }); banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: 'TARIFA', source_text: 'TARIFA', transaction_date: new Date('2026-10-31T00:00:00Z') }) // conta com extrato (tem linha do banco): 'devolvido' não lança o externo
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
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') }); banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: 'TARIFA', source_text: 'TARIFA', transaction_date: new Date('2026-10-31T00:00:00Z') }) // conta com extrato (tem linha do banco): 'devolvido' não lança o externo
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(doAR().filter((t) => t.bank_ref === 'AR:r1:estorno')).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })
})

describe("F10-B: o estorno pergunta — 'devolvido' (refs próprias ganham :devolvido) ou mover_para (engano)", () => {
  const PERGUNTA = 'O dinheiro foi devolvido ao cliente, ou foi lançado na OS errada?'
  const CORTE = '2026-10-29', DATA = '2026-11-02'
  const CAIXA = '33333333-3333-4333-8333-333333333333'
  const ajuste = (conta = ACC) => banco.transacao({ account_id: conta, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${conta}:${CORTE}`, created_at: new Date('2026-10-30T10:00:00Z'), transaction_date: dia(CORTE) })
  // Fix 11: conta COM extrato = tem linha do banco (o livro posta nela); só o AJUSTE não basta (a Inter tem AJUSTE e nenhuma linha).
  const extrato = (conta = ACC) => { ajuste(conta); banco.transacao({ account_id: conta, transaction_type: 'DEBIT', amount: 1, origin: 'BANCO', bank_ref: `TARIFA:${conta}`, source_text: 'TARIFA', transaction_date: dia('2026-10-31') }) }
  const estornos = (id = 'r1') => banco.tabelas.transaction.filter((t) => t.bank_ref === `AR:${id}:estorno`)
  const receberEm = (id: string, conta: string, valor = 50000, data = DATA) =>
    receber(new NextRequest('http://x/api', json({ received_amount: valor, account_id: conta, received_at: data })), { params: { id } })
  const linhaDoBanco = (chave: string, valor: number, links?: string[]) => lancarLinhas(new NextRequest('http://x/api', json({
    account_id: ACC, corte: CORTE, linhas: [{ chave, data: DATA, descricao: valor > 0 ? 'PIX RECEBIDO' : 'PIX ENVIADO', valor_centavos: valor, ...(links ? { links } : {}) }],
  })))
  const ligada = (over: Record<string, unknown> = {}) => banco.transacao({
    id: 'L', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, origin: 'BANCO', bank_ref: 'K1', source_text: 'PIX FULANO',
    linked_ref: 'AR:r1', category_id: 'cat:Venda de Servicos', description: 'LIQUIDACAO: OS 1 · banco: PIX FULANO', transaction_date: dia('2026-11-01'), ...over,
  })

  it('com dinheiro e sem resposta → 409 ESTORNO_PERGUNTA com os lançamentos; nada gravado', async () => {
    ajuste()
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    ligada()
    const { status, j } = await est()
    expect(status).toBe(409)
    expect(j).toEqual(expect.objectContaining({ code: 'ESTORNO_PERGUNTA', error: PERGUNTA, lancados: [expect.objectContaining({ valor_centavos: 15000, data: '2026-11-01' })] }))
    expect(ar().status).toBe('LIQUIDADO')
    expect(banco.tx_('L')!.linked_ref).toBe('AR:r1')
  })

  it("F12-A (#4): AR conferida (LIQUIDADO, reconciled) é estornável direto — sem Desfazer antes", async () => {
    extrato()
    banco.ar({ id: 'r1', status: 'LIQUIDADO', reconciled: true, account_id: ACC, received_amount: 15000, total_amount: 15000 })
    ligada()
    expect((await est()).status).toBe(409)
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0, reconciled: false }))
  })

  it("'devolvido' com linha ligada em conta com extrato → nada lançado; a linha fica AR:r1:devolvido (mesma data, categoria e saldo); AR PENDENTE/0", async () => {
    ajuste()
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    ligada()
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('L')).toEqual(expect.objectContaining({ linked_ref: 'AR:r1:devolvido', category_id: 'cat:Venda de Servicos', amount: 15000, bank_ref: 'K1' }))
    expect(estornos()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0, reconciled: false }))
  })

  it("#4/#9: depois do 'devolvido', o Receber da MESMA AR no Caixa lança o CREDIT no Caixa, sem pergunta", async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 0 })
    ajuste()
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000, description: 'OS 1' })
    ligada()
    await est('r1', { dinheiro: 'devolvido' })
    const res = await receber(new NextRequest('http://x/api', json({ received_amount: 15000, account_id: CAIXA, received_at: DATA })), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'AR:r1')).toEqual([expect.objectContaining({ account_id: CAIXA, amount: 15000, transaction_type: 'CREDIT' })])
    expect(banco.saldo(CAIXA)).toBe(15000)
  })

  it("#12: Receber → livro liga → 'devolvido' → a saída da devolução chega pelo extrato → o cliente paga de novo → o PIX novo liga: saldo = banco", async () => {
    ajuste()
    banco.ar({ id: 'ar1', status: 'PENDENTE', account_id: ACC, total_amount: 50000, description: 'OS 1' })
    await receberEm('ar1', ACC)
    expect((await (await linhaDoBanco(`ITAU:${DATA}|PIX RECEBIDO|+50000|1`, 50000)).json()).data.resultados[0]).toEqual(expect.objectContaining({ acao: 'LIGAR', origem: 'orfao' }))
    expect((await est('ar1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.saldo(ACC)).toBe(150000)
    await linhaDoBanco(`ITAU:${DATA}|PIX ENVIADO|-50000|1`, -50000)
    expect(banco.saldo(ACC)).toBe(100000) // banco: +500 −500
    const r = await receberEm('ar1', ACC, 50000, '2026-11-05')
    expect(r.status).toBe(200)
    expect(banco.saldo(ACC)).toBe(150000)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'AR:ar1')).toHaveLength(1)
  })

  it("F12-B (#5): Receber no Itaú sem linha (nocional) → 'devolvido' compensa (DEBIT :estorno, sem renomear); no dia seguinte a linha +X e a saída −X chegam → saldo = banco", async () => {
    extrato()
    banco.ar({ id: 'ar1', status: 'PENDENTE', account_id: ACC, total_amount: 50000, description: 'OS 1' })
    await receberEm('ar1', ACC)
    expect(banco.saldo(ACC)).toBe(150000)
    expect((await est('ar1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'AR:ar1')).toHaveLength(1)
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'AR:ar1:devolvido')).toEqual([])
    expect(estornos('ar1')).toEqual([expect.objectContaining({ account_id: ACC, amount: 50000, transaction_type: 'DEBIT' })])
    expect(banco.saldo(ACC)).toBe(100000)
    await linhaDoBanco(`ITAU:${DATA}|PIX RECEBIDO|+50000|1`, 50000)
    await linhaDoBanco(`ITAU:${DATA}|PIX ENVIADO|-50000|1`, -50000)
    expect(banco.saldo(ACC)).toBe(100000) // banco: +500 −500
  })

  it("F12-C (#3): PIX QRS +300 com links [AR:A, AR:B] e A devolvido antes do extrato → o nocional compensado de A não é ligável: converte B, cria +100; a saída −100 chega → saldo = banco", async () => {
    extrato()
    banco.ar({ id: 'A', status: 'PENDENTE', account_id: ACC, total_amount: 10000, description: 'OS A' })
    banco.ar({ id: 'B', status: 'PENDENTE', account_id: ACC, total_amount: 20000, description: 'OS B' })
    await receberEm('A', ACC, 10000)
    await receberEm('B', ACC, 20000)
    expect(banco.saldo(ACC)).toBe(130000)
    await est('A', { dinheiro: 'devolvido' })
    expect(banco.saldo(ACC)).toBe(120000)
    const r = await (await lancarLinhas(new NextRequest('http://x/api', json({
      account_id: ACC, corte: CORTE, linhas: [{ chave: `ITAU:${DATA}|PIX QRS|+30000|1`, data: DATA, descricao: 'PIX QRS', valor_centavos: 30000, links: ['AR:A', 'AR:B'] }],
    })))).json()
    expect(r.data.erros ?? []).toEqual([])
    expect(banco.tabelas.transaction.find((t) => t.bank_ref === 'AR:A')).toEqual(expect.objectContaining({ origin: null })) // o par compensado fica
    expect(banco.tabelas.transaction.filter((t) => t.origin === 'BANCO' && t.linked_ref === 'AR:B')).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(130000) // banco: 100000 + 300 (ainda sem a saída)
    await linhaDoBanco(`ITAU:${DATA}|PIX ENVIADO|-10000|1`, -10000)
    expect(banco.saldo(ACC)).toBe(120000) // banco: +300 −100
  })

  it("F13-A: nocional ANTERIOR ao ajuste no Itaú (conta com linha do banco) → o ajuste já o absorveu: só o sufixo :devolvido, saldo intacto; a saída da devolução chega → saldo = banco", async () => {
    extrato()
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ id: 'N', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1', created_at: new Date('2026-10-20T15:00:00Z') })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('N')!.bank_ref).toBe('AR:r1:devolvido')
    expect(estornos()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    await linhaDoBanco(`ITAU:${DATA}|PIX ENVIADO|-15000|1`, -15000)
    expect(banco.saldo(ACC)).toBe(85000) // banco: 1000,00 − a devolução de 150,00
  })

  it("F13-A: o mesmo nocional anterior ao ajuste na Inter (AJUSTE, sem linha do banco) → compensa com DEBIT :estorno", async () => {
    ajuste(ACC2)
    banco.tabelas.account[1].current_balance = 15000
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC2, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ id: 'N', account_id: ACC2, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1', created_at: new Date('2026-10-20T15:00:00Z') })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('N')!.bank_ref).toBe('AR:r1')
    expect(estornos()).toEqual([expect.objectContaining({ account_id: ACC2, amount: 15000, transaction_type: 'DEBIT' })])
    expect(banco.saldo(ACC2)).toBe(0)
  })

  it("'devolvido' no Caixa (sem extrato) → DEBIT AR:r1:estorno no Caixa (o nocional fica, compensado): o saldo do Caixa volta", async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 15000 })
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: CAIXA, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ id: 'N', account_id: CAIXA, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('N')!.bank_ref).toBe('AR:r1')
    expect(estornos()).toEqual([expect.objectContaining({ account_id: CAIXA, amount: 15000, transaction_type: 'DEBIT' })])
    expect(banco.saldo(CAIXA)).toBe(0)
  })

  it("F12-B: nocionais no Caixa e no Itaú (nenhum confirmado pelo banco) → compensa os dois, cada um na sua conta; a linha confirmada só ganha o sufixo", async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 5000 })
    extrato()
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 20000, total_amount: 20000 })
    banco.transacao({ id: 'C', account_id: CAIXA, transaction_type: 'CREDIT', amount: 5000, bank_ref: 'AR:r1' })
    banco.transacao({ id: 'I', account_id: ACC, transaction_type: 'CREDIT', amount: 10000, bank_ref: 'AR:r1' })
    ligada({ amount: 5000 })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect([banco.tx_('C')!.bank_ref, banco.tx_('I')!.bank_ref, banco.tx_('L')!.linked_ref]).toEqual(['AR:r1', 'AR:r1', 'AR:r1:devolvido'])
    expect(estornos().map((t) => [t.account_id, t.amount]).sort()).toEqual([[ACC, 10000], [CAIXA, 5000]].sort())
    expect(banco.saldo(ACC)).toBe(90000)
    expect(banco.saldo(CAIXA)).toBe(0)
  })

  it("'devolvido' no Caixa com crédito externo no MESMO Caixa: o :estorno anula só o devolvido — o externo continua dinheiro da conta (o Receber pergunta por ele)", async () => {
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 20000 })
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: CAIXA, received_amount: 20000, total_amount: 20000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_c', status: 'RECEIVED' })
    banco.transacao({ id: 'X', account_id: CAIXA, transaction_type: 'CREDIT', amount: 5000, bank_ref: 'pay_c' })
    banco.transacao({ id: 'N', account_id: CAIXA, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(estornos()).toEqual([expect.objectContaining({ account_id: CAIXA, amount: 15000 })])
    const res = await receber(new NextRequest('http://x/api', json({ received_amount: 20000, account_id: CAIXA, received_at: DATA })), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).lancados).toEqual([expect.objectContaining({ valor_centavos: 5000, origem: expect.stringContaining('pay_c') })])
  })

  it("'devolvido' com dinheiro externo (Asaas pay_) → o externo não é tocado (a devolução passa pelo Asaas); a resposta traz o aviso", async () => {
    ajuste()
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED' })
    banco.transacao({ id: 'X', account_id: ACC, transaction_type: 'CREDIT', amount: 14550, bank_ref: 'pay_x' })
    const { status, j } = await est('r1', { dinheiro: 'devolvido' })
    expect(status).toBe(200)
    expect(j.data.aviso).toMatch(/^dinheiro externo não foi tocado.*pay_x/)
    expect(banco.tx_('X')).toEqual(expect.objectContaining({ bank_ref: 'pay_x', amount: 14550 }))
    expect(estornos()).toEqual([])
    expect(ar().status).toBe('PENDENTE')
  })

  it("#13: venda da maquininha cancelada antes do repasse (acquirer: no Itaú, conta com extrato) → 'devolvido' só avisa (o repasse da Rede traz a devolução)", async () => {
    extrato()
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 10000, total_amount: 10000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: '555', status: 'RECEIVED' })
    banco.transacao({ id: 'A', account_id: ACC, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'acquirer:rede:555' })
    const { j } = await est('r1', { dinheiro: 'devolvido' })
    expect(j.data.aviso).toMatch(/acquirer:rede:555/)
    expect(banco.tx_('A')!.bank_ref).toBe('acquirer:rede:555')
    expect(estornos()).toEqual([])
  })

  it("F12-B (#1/#6): AR paga por boleto CNAB na Inter (AJUSTE, sem linha do banco) → 'devolvido' compensa o cnab: com DEBIT :estorno na Inter", async () => {
    ajuste(ACC2)
    banco.tabelas.account[1].current_balance = 50000
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC2, received_amount: 50000, total_amount: 50000, pix_code: JSON.stringify({ nossoNumero: '123' }) })
    banco.transacao({ id: 'B', account_id: ACC2, transaction_type: 'CREDIT', amount: 50000, bank_ref: 'cnab:123' })
    const { status, j } = await est('r1', { dinheiro: 'devolvido' })
    expect(status).toBe(200)
    expect(j.data.aviso).toBeUndefined()
    expect(banco.tx_('B')!.bank_ref).toBe('cnab:123')
    expect(estornos()).toEqual([expect.objectContaining({ account_id: ACC2, amount: 50000, transaction_type: 'DEBIT' })])
    expect(banco.saldo(ACC2)).toBe(0)
    // a AR fica livre: nem o Receber pergunta, nem o DELETE trava pelo cnab:
    const res = await receber(new NextRequest('http://x/api', json({ received_amount: 50000, account_id: ACC2, received_at: DATA })), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
  })

  it("F12-B: adquirente em conta fora do livro (sem linha do banco) → compensa; pay_ (Asaas) nunca — só aviso", async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC2, received_amount: 20000, total_amount: 20000 })
    banco.pagamento({ receivable_id: 'r1', provider: 'rede', external_id: '9', status: 'RECEIVED' })
    banco.pagamento({ receivable_id: 'r1', provider: 'asaas', external_id: 'pay_q', status: 'RECEIVED' })
    banco.transacao({ account_id: ACC2, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'acquirer:rede:9' })
    banco.transacao({ account_id: ACC2, transaction_type: 'CREDIT', amount: 9800, bank_ref: 'pay_q' })
    const { j } = await est('r1', { dinheiro: 'devolvido' })
    expect(estornos()).toEqual([expect.objectContaining({ account_id: ACC2, amount: 9700 })])
    expect(j.data.aviso).toMatch(/pay_q/)
    expect(j.data.aviso).not.toMatch(/acquirer:rede:9/)
  })

  it("'devolvido' de antecipada (nocional, conta sem extrato) → DEBIT :estorno, o nocional fica; anticipated_at volta a null", async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 14000, total_amount: 15000, anticipated_at: new Date('2026-10-20T12:00:00Z') })
    banco.transacao({ id: 'T', account_id: ACC, transaction_type: 'CREDIT', amount: 14000, bank_ref: 'AR:r1:anticipation' })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('T')!.bank_ref).toBe('AR:r1:anticipation')
    expect(banco.saldo(ACC)).toBe(86000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0, anticipated_at: null }))
  })

  it("marcador antigo LIGADA (origin null, bank_ref AR:r1) também ganha o sufixo e deixa de ser dinheiro da conta", async () => {
    extrato()
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ id: 'G', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1', source_text: 'LIGADA:ITAU:k' })
    await est('r1', { dinheiro: 'devolvido' })
    expect(banco.tx_('G')!.bank_ref).toBe('AR:r1:devolvido')
    expect(estornos()).toEqual([])
  })

  it("estorno repetido → 400 'nada a estornar'", async () => {
    ajuste()
    banco.ar({ id: 'r1', status: 'LIQUIDADO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    ligada()
    await est('r1', { dinheiro: 'devolvido' })
    const { status, j } = await est('r1', { dinheiro: 'devolvido' })
    expect(status).toBe(400)
    expect(j.error).toBe('nada a estornar')
  })

  it("resposta inválida (inclusive o antigo 'permanece', ou as duas escolhas juntas) → 400", async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    for (const corpo of [{ dinheiro: 'permanece' }, { dinheiro: 'talvez' }, { dinheiro: 'devolvido', mover_para: 'r2' }, { mover_para: '' }]) {
      expect((await est('r1', corpo)).status, JSON.stringify(corpo)).toBe(400)
    }
  })

  it("Fix 11: conta com AJUSTE mas SEM nenhuma linha do banco (a Inter) → 'devolvido' compensa como no Caixa", async () => {
    ajuste(ACC2)
    banco.tabelas.account[1].current_balance = 15000
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC2, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ id: 'N', account_id: ACC2, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:r1' })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('N')!.bank_ref).toBe('AR:r1')
    expect(estornos()).toEqual([expect.objectContaining({ account_id: ACC2, amount: 15000, transaction_type: 'DEBIT' })])
    expect(banco.saldo(ACC2)).toBe(0)
  })

  it("F12-B: a linha confirmada pelo extrato (conta com linha do banco, mesmo sem AJUSTE) → só o sufixo, nada lançado", async () => {
    ligada({ account_id: ACC2 })
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC2, received_amount: 15000, total_amount: 15000 })
    expect((await est('r1', { dinheiro: 'devolvido' })).status).toBe(200)
    expect(banco.tx_('L')!.linked_ref).toBe('AR:r1:devolvido')
    expect(estornos()).toEqual([])
  })

  it('sem dinheiro na conta → só status, sem pergunta', async () => {
    banco.ar({ id: 'r1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: new Date('2026-07-01T00:00:00Z') })
    expect((await est()).status).toBe(200)
    expect(ar().status).toBe('PENDENTE')
  })
})

describe('F10-B: mover_para — o dinheiro foi lançado na OS errada (move linhas, nocionais e Payments; nada novo)', () => {
  const CORTE = '2026-10-29', DATA = '2026-11-02'
  const ajuste = () => banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:${CORTE}`, created_at: new Date('2026-10-30T10:00:00Z'), transaction_date: dia(CORTE) })
  const contar = () => banco.tabelas.transaction.length

  it('#11: linha ligada à OS errada → mover_para a AR certa: a linha passa para AR:<certa> (descrição dela), nenhum lançamento novo, saldos intactos; destino RECEBIDO, origem PENDENTE/0', async () => {
    ajuste()
    banco.ar({ id: 'a1', status: 'RECEBIDO', account_id: ACC, received_amount: 50000, total_amount: 50000, description: 'OS 1' })
    banco.ar({ id: 'b1', status: 'PENDENTE', account_id: ACC, received_amount: 0, total_amount: 50000, description: 'OS 2' })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'CREDIT', amount: 50000, origin: 'BANCO', bank_ref: 'K1', source_text: 'PIX B', linked_ref: 'AR:a1', description: 'Recebimento: OS 1 · banco: PIX B' })
    const n = contar()
    expect((await est('a1')).status).toBe(409)
    const { status, j } = await est('a1', { mover_para: 'b1' })
    expect(status).toBe(200)
    expect(j.data).toEqual(expect.objectContaining({ movido_para: 'b1' }))
    expect(banco.tx_('L')).toEqual(expect.objectContaining({ linked_ref: 'AR:b1', description: 'Recebimento: OS 2 · banco: PIX B', amount: 50000 }))
    expect(contar()).toBe(n)
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar('a1')).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 0 }))
    expect(ar('b1')).toEqual(expect.objectContaining({ status: 'RECEBIDO', received_amount: 50000 }))
    // a OS certa já tem o dinheiro: o Receber dela pergunta em vez de lançar 2x
    const r = await receber(new NextRequest('http://x/api', json({ received_amount: 50000, account_id: ACC, received_at: DATA })), { params: { id: 'b1' } })
    expect(r.status).toBe(400) // já recebida
  })

  it('mover_para pelo número da OS: resolve a conta a receber aberta dela', async () => {
    banco.inserir('serviceOrder', { id: 'so2', company_id: 'c1', os_number: 61234 })
    banco.ar({ id: 'a1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, description: 'OS 1' })
    banco.ar({ id: 'b1', status: 'CANCELADO', account_id: ACC, total_amount: 15000, service_order_id: 'so2', description: 'OS 61234 (antiga)' })
    banco.ar({ id: 'b2', status: 'PENDENTE', account_id: ACC, received_amount: 0, total_amount: 15000, service_order_id: 'so2', description: 'OS 61234' })
    banco.transacao({ id: 'N', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    const { status, j } = await est('a1', { mover_para: '61234' })
    expect(status).toBe(200)
    expect(j.data.movido_para).toBe('b2')
    expect(banco.tx_('N')!.bank_ref).toBe('AR:b2')
    expect(ar('b2')).toEqual(expect.objectContaining({ status: 'RECEBIDO', received_amount: 15000 }))
  })

  it('#2: match errado da maquininha → mover_para: o Payment (receivable_id e service_order_id) vai para a OS certa; o crédito do adquirente fica como está', async () => {
    banco.ar({ id: 'a1', status: 'RECEBIDO', account_id: ACC, received_amount: 10000, total_amount: 10000, service_order_id: 'so1' })
    banco.ar({ id: 'b1', status: 'PENDENTE', account_id: ACC, received_amount: 0, total_amount: 10000, service_order_id: 'so2', description: 'OS 2' })
    banco.pagamento({ id: 'pg1', receivable_id: 'a1', service_order_id: 'so1', provider: 'rede', external_id: 'NSU1', status: 'RECEIVED' })
    banco.pagamento({ id: 'pg9', receivable_id: 'a1', provider: 'asaas', external_id: 'pay_aberta', status: 'PENDING' })
    banco.transacao({ id: 'A', account_id: ACC, transaction_type: 'CREDIT', amount: 9700, bank_ref: 'acquirer:rede:NSU1' })
    const n = contar()
    expect((await est('a1', { mover_para: 'b1' })).status).toBe(200)
    const pg = (id: string) => banco.tabelas.payment.find((x) => x.id === id)!
    expect(pg('pg1')).toEqual(expect.objectContaining({ receivable_id: 'b1', service_order_id: 'so2' }))
    expect(pg('pg9').receivable_id).toBe('a1') // cobrança não paga não é dinheiro: fica
    expect(banco.tx_('A')!.bank_ref).toBe('acquirer:rede:NSU1')
    expect(contar()).toBe(n)
    expect(ar('b1')).toEqual(expect.objectContaining({ status: 'RECEBIDO', received_amount: 10000 }))
  })

  it('destino com saldo em aberto menor que o valor → 422, nada gravado', async () => {
    banco.ar({ id: 'a1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.ar({ id: 'b1', status: 'PENDENTE', account_id: ACC, received_amount: 10000, total_amount: 20000 })
    banco.transacao({ id: 'N', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    const { status, j } = await est('a1', { mover_para: 'b1' })
    expect(status).toBe(422)
    expect(j.error).toBe('valor maior que o saldo em aberto da conta de destino')
    expect(banco.tx_('N')!.bank_ref).toBe('AR:a1')
    expect(ar('a1').status).toBe('RECEBIDO')
  })

  it('destino parcial: soma o valor e fica PENDENTE (o status parcial do Receber)', async () => {
    banco.ar({ id: 'a1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.ar({ id: 'b1', status: 'PENDENTE', account_id: ACC, received_amount: 5000, total_amount: 30000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    expect((await est('a1', { mover_para: 'b1' })).status).toBe(200)
    expect(ar('b1')).toEqual(expect.objectContaining({ status: 'PENDENTE', received_amount: 20000 }))
  })

  it('destino inexistente, de outra empresa, CANCELADO ou a própria conta → 404/422, nada gravado', async () => {
    banco.ar({ id: 'a1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.ar({ id: 'x1', company_id: 'c2', status: 'PENDENTE', total_amount: 15000 })
    banco.ar({ id: 'c1x', status: 'CANCELADO', total_amount: 15000 })
    banco.transacao({ id: 'N', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    expect((await est('a1', { mover_para: 'nao-existe' })).status).toBe(422) // nem id de AR, nem nº de OS
    expect((await est('a1', { mover_para: 'x1' })).status).toBe(422) // AR de outra empresa: não é id daqui
    expect((await est('a1', { mover_para: '99999' })).status).toBe(404) // nº de OS que não existe
    expect((await est('a1', { mover_para: 'c1x' })).status).toBe(422)
    expect((await est('a1', { mover_para: 'a1' })).status).toBe(422)
    expect(banco.tx_('N')!.bank_ref).toBe('AR:a1')
  })

  it('F12-D (#2, m6, m11): destino AGRUPADO ou com grouped_into_id → 422; pelo nº da OS a original agrupada não conta como aberta', async () => {
    banco.inserir('serviceOrder', { id: 'so2', company_id: 'c1', os_number: 62100 })
    banco.ar({ id: 'a0', status: 'RECEBIDO', account_id: ACC, received_amount: 30000, total_amount: 30000 })
    banco.ar({ id: 'A1', status: 'AGRUPADO', account_id: ACC, received_amount: 0, total_amount: 30000, service_order_id: 'so2', grouped_into_id: 'G' })
    banco.ar({ id: 'A2', status: 'PENDENTE', account_id: ACC, received_amount: 0, total_amount: 30000, grouped_into_id: 'G' })
    banco.ar({ id: 'G', status: 'PENDENTE', account_id: ACC, received_amount: 0, total_amount: 60000 })
    banco.transacao({ id: 'N', account_id: ACC, transaction_type: 'CREDIT', amount: 30000, bank_ref: 'AR:a0' })
    for (const alvo of ['A1', 'A2']) {
      const r = await est('a0', { mover_para: alvo })
      expect([r.status, r.j.error], alvo).toEqual([422, 'conta agrupada — escolha a agrupadora'])
    }
    const pelaOS = await est('a0', { mover_para: '62100' })
    expect([pelaOS.status, pelaOS.j.error]).toEqual([422, 'OS 62100 sem conta a receber em aberto'])
    expect(banco.tx_('N')!.bank_ref).toBe('AR:a0')
    expect((await est('a0', { mover_para: 'G' })).status).toBe(200) // a agrupadora é o destino certo
  })

  it('F12-D (m12): nº de OS com mais de 9 dígitos → 422, sem 500', async () => {
    banco.ar({ id: 'a1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    const r = await est('a1', { mover_para: '12345678901' })
    expect(r.status).toBe(422)
  })

  it('m13: origem sem dinheiro → 422; OS com várias contas em aberto → 422 (informe a conta)', async () => {
    banco.inserir('serviceOrder', { id: 'so3', company_id: 'c1', os_number: 700 })
    banco.ar({ id: 'a1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, updated_at: new Date('2026-07-01T00:00:00Z') })
    banco.ar({ id: 'b1', status: 'PENDENTE', account_id: ACC, total_amount: 15000, service_order_id: 'so3' })
    banco.ar({ id: 'b2', status: 'PENDENTE', account_id: ACC, total_amount: 15000, service_order_id: 'so3' })
    const semDinheiro = await est('a1', { mover_para: 'b1' })
    expect([semDinheiro.status, semDinheiro.j.error]).toEqual([422, 'não há dinheiro lançado nesta conta para mover'])
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    const varias = await est('a1', { mover_para: '700' })
    expect([varias.status, varias.j.error]).toEqual([422, 'OS 700 tem 2 contas a receber em aberto — informe a conta'])
  })

  it('m4: a linha movida ganha a categoria da conta de destino quando tinha a da origem; a de outra categoria fica', async () => {
    banco.categoria('Peças', 'financeiro_receita')
    banco.ar({ id: 'a1', status: 'RECEBIDO', account_id: ACC, received_amount: 15001, total_amount: 15001, category_id: 'cat:Venda de Servicos' })
    banco.ar({ id: 'b1', status: 'PENDENTE', account_id: ACC, total_amount: 15001, category_id: 'cat:Peças', description: 'OS 2' })
    banco.transacao({ id: 'L', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, origin: 'BANCO', bank_ref: 'K', source_text: 'PIX', linked_ref: 'AR:a1', category_id: 'cat:Venda de Servicos' })
    banco.transacao({ id: 'M', account_id: ACC, transaction_type: 'CREDIT', amount: 1, origin: 'BANCO', bank_ref: 'K2', source_text: 'REND', linked_ref: 'AR:a1', category_id: 'cat:Rendimentos' })
    expect((await est('a1', { mover_para: 'b1' })).status).toBe(200)
    expect(banco.tx_('L')).toEqual(expect.objectContaining({ linked_ref: 'AR:b1', category_id: 'cat:Peças' }))
    expect(banco.tx_('M')).toEqual(expect.objectContaining({ linked_ref: 'AR:b1', category_id: 'cat:Rendimentos' }))
  })

  it('antecipação ou boleto CNAB na origem → 422 (não dá para mover; estorne como devolvido)', async () => {
    banco.ar({ id: 'a1', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000, pix_code: JSON.stringify({ nossoNumero: '77' }) })
    banco.ar({ id: 'b1', status: 'PENDENTE', account_id: ACC, received_amount: 0, total_amount: 15000 })
    banco.transacao({ id: 'C', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'cnab:77' })
    expect((await est('a1', { mover_para: 'b1' })).status).toBe(422)
    expect(banco.tx_('C')!.bank_ref).toBe('cnab:77')
  })

  it('travas: contas → as duas ARs (FOR UPDATE, em ordem de id) → escritas, tudo pelo tx', async () => {
    banco.ar({ id: 'z9', status: 'RECEBIDO', account_id: ACC, received_amount: 15000, total_amount: 15000 })
    banco.ar({ id: 'b1', status: 'PENDENTE', account_id: ACC, received_amount: 0, total_amount: 15000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:z9' })
    expect((await est('z9', { mover_para: 'b1' })).status).toBe(200)
    expect(banco.travas.map((t) => [t.tabela, t.id])).toEqual([['accounts', ACC], ['accounts_receivable', 'b1'], ['accounts_receivable', 'z9']])
    const escritas = banco.log.filter((o) => ['create', 'update', 'updateMany', 'delete'].includes(o.op))
    expect(escritas.every((o) => o.cliente === 'tx' && o.seq > banco.travas[2].seq)).toBe(true)
    expect(banco.prismaDentroDaTx()).toEqual([])
  })
})

