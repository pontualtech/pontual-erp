import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/observability', () => ({ logError: vi.fn(async () => undefined) }))
vi.mock('@/lib/financeiro/livro-baixa-db', async (importOriginal) => {
  const o = await importOriginal<typeof import('@/lib/financeiro/livro-baixa-db')>()
  return { ...o, hojeSP: vi.fn(o.hojeSP) }
})

import { POST } from './route'
import { hojeSP } from '@/lib/financeiro/livro-baixa-db'
import { banco } from '@/test-utils/banco-falso'
import { logAudit } from '@/lib/audit'
import { logError } from '@/lib/observability'

const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const DIA = 86_400_000
const diaRel = (dias: number) => new Date(Date.parse(`${hoje}T00:00:00Z`) + dias * DIA)
const ACC = 'acc1'
const post = async (body: unknown) => {
  const res = await POST(new NextRequest('http://x/api/financeiro/contas-receber/bulk-reconcile', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { status: res.status, j: await res.json() }
}
const conferir = (ids: string[] = ['a1'], livro?: Record<string, string>) => post({ ids, reconciled: true, ...(livro ? { livro } : {}) })
const desfazer = (ids: string[] = ['a1']) => post({ ids, reconciled: false })
const ar = (id = 'a1') => banco.tabelas.accountReceivable.find((a) => a.id === id)!
const AR = { id: 'a1', account_id: ACC, received_amount: 15000, total_amount: 15000, status: 'RECEBIDO', description: 'OS 1' }
// Linha do livro (BANCO) livre, de hoje, em "Receita a identificar".
const linhaLivro = (over: Record<string, unknown> = {}) => banco.transacao({
  id: 't1', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, origin: 'BANCO', bank_ref: 'ITAU:k1',
  source_text: 'PIX CLIENTE', description: 'PIX CLIENTE', category_id: 'cat:Receita a identificar', transaction_date: diaRel(0), ...over,
})
const creditosAR = (id = 'a1') => banco.tabelas.transaction.filter((t) => t.bank_ref === `AR:${id}`)

beforeEach(() => {
  banco.reset()
  banco.categoriasPadrao()
  banco.conta({ id: ACC, current_balance: 100000 })
  vi.mocked(hojeSP).mockReset() // volta à implementação real (descarta mockReturnValueOnce pendente)
})

describe('bulk-reconcile — Conferir liga ao lançamento do livro', () => {
  it('AR com linha do livro casando: liga, sem criar transação nem mexer no saldo', async () => {
    banco.ar(AR)
    linhaLivro()
    const { j } = await conferir()
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: 'AR:a1', category_id: 'cat:Venda de Servicos', description: 'LIQUIDACAO: OS 1 · banco: PIX CLIENTE' }))
    expect(creditosAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar()).toEqual(expect.objectContaining({ reconciled: true, status: 'LIQUIDADO' }))
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 1, erros: [] }))
  })

  it('sem candidato: cria o crédito AR:id com a categoria Receita de serviços e soma no saldo', async () => {
    banco.ar(AR)
    const { j } = await conferir()
    expect(creditosAR()).toEqual([expect.objectContaining({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, category_id: 'cat:Venda de Servicos', reconciled: true })])
    expect(banco.saldo(ACC)).toBe(115000)
    expect(j.data.balance_delta).toBe(15000)
  })

  it('linha já categorizada (Venda de Servicos): liga e mantém a categoria da linha', async () => {
    banco.ar(AR)
    linhaLivro({ category_id: 'cat:Venda de Servicos', source_text: 'PIX RECEBIDO FULANO' })
    const { j } = await conferir()
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: 'AR:a1', category_id: 'cat:Venda de Servicos', description: 'LIQUIDACAO: OS 1 · banco: PIX RECEBIDO FULANO' }))
    expect(j.data).toEqual(expect.objectContaining({ ligadas: 1, balance_delta: 0 }))
  })

  it('F3: Conferir 20 dias depois do crédito do banco liga (janela 30 antes / 3 depois)', async () => {
    banco.ar(AR)
    linhaLivro({ transaction_date: diaRel(-20) })
    expect((await conferir()).j.data.ligadas).toBe(1)
    banco.tx_('t1')!.linked_ref = null
    Object.assign(ar(), { status: 'RECEBIDO', reconciled: false })
    banco.tx_('t1')!.transaction_date = diaRel(-31)
    expect((await conferir()).j.data.ligadas).toBe(0) // fora da janela: cria
  })

  it('E3: com vínculo explícito vale a linha pedida (por id) mesmo fora da janela de 30 dias', async () => {
    banco.ar(AR)
    linhaLivro({ id: 't9', transaction_date: diaRel(-40) })
    const { j } = await conferir(['a1'], { a1: 't9' })
    expect(j.data).toEqual(expect.objectContaining({ ligadas: 1, erros: [] }))
    expect(banco.tx_('t9')!.linked_ref).toBe('AR:a1')
  })

  it('E11: hojeSP uma vez por AR — virada da meia-noite entre a busca e a decisão não muda a janela', async () => {
    vi.mocked(hojeSP).mockReturnValueOnce('2026-10-30').mockReturnValueOnce('2026-10-31')
    banco.ar(AR)
    linhaLivro({ transaction_date: new Date('2026-09-30T00:00:00Z') }) // 30 dias antes de 30/10 (31 antes de 31/10)
    expect((await conferir()).j.data.ligadas).toBe(1)
  })

  it('AR legada PAGO (recebida) é conferida: cria o crédito e vira LIQUIDADO', async () => {
    banco.ar({ ...AR, status: 'PAGO' })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, erros: [] }))
    expect(creditosAR()).toHaveLength(1)
    expect(ar().status).toBe('LIQUIDADO')
  })

  it('PENDENTE e CANCELADO não são conferidos ("conta não recebida"), com ou sem conta bancária', async () => {
    banco.ar({ ...AR, id: 'p', status: 'PENDENTE' })
    banco.ar({ ...AR, id: 'c', status: 'CANCELADO' })
    banco.ar({ ...AR, id: 's', status: 'PENDENTE', account_id: null })
    const { j } = await conferir(['p', 'c', 's'])
    expect(j.data.erros).toEqual(['p', 'c', 's'].map((ar) => ({ ar, motivo: 'conta não recebida' })))
    expect(banco.tabelas.accountReceivable.every((a) => a.status !== 'LIQUIDADO')).toBe(true)
    expect(banco.tabelas.transaction).toEqual([])
  })

  it('webhook Inter marcou reconciled=true sem lançar crédito: Conferir cria o crédito', async () => {
    banco.ar({ ...AR, reconciled: true })
    await conferir()
    expect(creditosAR()).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(115000)
  })

  it('AR sem conta bancária: só vira LIQUIDADO; com vínculo explícito vai em erros (F11)', async () => {
    banco.ar({ ...AR, account_id: null })
    expect((await conferir(['a1'], { a1: 't1' })).j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta a receber sem conta bancária; vínculo não feito' }])
    expect(ar().status).toBe('RECEBIDO')
    expect((await conferir()).j.data).toEqual(expect.objectContaining({ updated: 1, erros: [] }))
    expect(ar().status).toBe('LIQUIDADO')
    expect(banco.tabelas.transaction).toEqual([])
  })

  it('F11: vínculo explícito e AR sem valor: vai em erros', async () => {
    banco.ar({ ...AR, received_amount: 0, total_amount: 0 })
    expect((await conferir(['a1'], { a1: 't1' })).j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta a receber sem valor; vínculo não feito' }])
  })

  it('vínculo explícito inválido (linha já categorizada em Energia): AR não é baixada e vai em erros', async () => {
    banco.ar(AR)
    linhaLivro({ category_id: 'cat:Energia' })
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'Lançamento do livro já está categorizado' }])
    expect(ar().status).toBe('RECEBIDO')
  })

  it('vínculo explícito já feito para esta AR: idempotente (LIQUIDADO, ligadas 1, nada criado)', async () => {
    banco.ar(AR)
    linhaLivro({ linked_ref: 'AR:a1' })
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 1, erros: [] }))
    expect(creditosAR()).toEqual([])
  })

  it('#18: linha ligada por outra baixa no meio (guard count 0): erro E a virada da AR para LIQUIDADO é desfeita (rollback)', async () => {
    banco.ar(AR)
    linhaLivro()
    banco.tx.transaction.updateMany.mockImplementationOnce(async () => ({ count: 0 }))
    const { j } = await conferir()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'lançamento do livro já ligado por outra baixa' }])
    expect(ar()).toEqual(expect.objectContaining({ status: 'RECEBIDO', reconciled: false }))
    expect(banco.transacoes.at(-1)!.desfeita).toBe(true)
    expect(creditosAR()).toEqual([])
  })

  it('corpo `livro` inválido: 422 sem processar nada', async () => {
    banco.ar(AR)
    for (const livroInvalido of [{ a1: 123 }, 'x', ['t1']]) {
      const { status } = await post({ ids: ['a1'], reconciled: true, livro: livroInvalido })
      expect(status).toBe(422)
    }
    expect(ar().status).toBe('RECEBIDO')
  })
})

describe('§4 Desfazer conciliação (reconciled=false) — resolve #8 e m1', () => {
  it('#8: AR já estornada (PENDENTE, não conferida): erro "conta não conferida", nada apagado nem debitado', async () => {
    banco.ar({ ...AR, status: 'PENDENTE', received_amount: 0, reconciled: false })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 15000, bank_ref: 'AR:a1:estorno' })
    const { j } = await desfazer()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta não conferida' }])
    expect(j.data.updated).toBe(0)
    expect(banco.tabelas.transaction).toHaveLength(2)
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar().status).toBe('PENDENTE')
  })

  it('RECEBIDO ainda não conferido também não é desfeito', async () => {
    banco.ar({ ...AR, status: 'RECEBIDO', reconciled: false })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    expect((await desfazer()).j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta não conferida' }])
    expect(creditosAR()).toHaveLength(1)
  })

  it('m1: vários créditos nocionais (baixas parciais 400 + 600): apaga TODOS e debita 1000', async () => {
    banco.ar({ ...AR, status: 'LIQUIDADO', reconciled: true, received_amount: 100000, total_amount: 100000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 40000, bank_ref: 'AR:a1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 60000, bank_ref: 'AR:a1' })
    const { j } = await desfazer()
    expect(creditosAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(0)
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, balance_delta: -100000, erros: [] }))
    expect(ar()).toEqual(expect.objectContaining({ status: 'RECEBIDO', reconciled: false }))
  })

  it('crédito já compensado por :estorno não é apagado; o recebido de novo depois do estorno é', async () => {
    banco.ar({ ...AR, status: 'LIQUIDADO', reconciled: true })
    banco.transacao({ id: 'velho', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    banco.transacao({ id: 'est', account_id: ACC, transaction_type: 'DEBIT', amount: 15000, bank_ref: 'AR:a1:estorno' })
    banco.transacao({ id: 'novo', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    const { j } = await desfazer()
    expect(banco.tx_('velho')).toBeDefined()
    expect(banco.tx_('est')).toBeDefined()
    expect(banco.tx_('novo')).toBeUndefined()
    expect(j.data.balance_delta).toBe(-15000)
  })

  it('linha do banco ligada (baixa ou nocional convertido): DESLIGA (regra/fallback, texto do banco), sem apagar nem mexer no saldo', async () => {
    banco.regra({ pattern: 'REND PAGO APLIC', direction: 'IN', category_id: 'cat:Rendimentos', priority: 10 })
    banco.ar({ ...AR, status: 'LIQUIDADO', reconciled: true })
    linhaLivro({ linked_ref: 'AR:a1', category_id: 'cat:Venda de Servicos', description: 'LIQUIDACAO: OS 1 · banco: PIX CLIENTE' })
    linhaLivro({ id: 't2', bank_ref: 'ITAU:k2', amount: 1, linked_ref: 'AR:a1', source_text: 'REND PAGO APLIC AUT', category_id: 'cat:Venda de Servicos' })
    const { j } = await desfazer()
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: null, category_id: 'cat:Receita a identificar', description: 'PIX CLIENTE' }))
    expect(banco.tx_('t2')).toEqual(expect.objectContaining({ linked_ref: null, category_id: 'cat:Rendimentos' }))
    expect(banco.saldo(ACC)).toBe(100000)
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, balance_delta: 0 }))
    expect(ar().status).toBe('RECEBIDO')
  })

  it('linha convertida do adquirente (linked_ref acquirer:…) NÃO é desligada pelo Desfazer (não veio do Conferir)', async () => {
    banco.ar({ ...AR, status: 'LIQUIDADO', reconciled: true })
    banco.pagamento({ receivable_id: 'a1', provider: 'rede', external_id: 'N1' })
    linhaLivro({ linked_ref: 'acquirer:rede:N1' })
    await desfazer()
    expect(banco.tx_('t1')!.linked_ref).toBe('acquirer:rede:N1')
    expect(ar().status).toBe('RECEBIDO')
  })

  it('E2: crédito AR:id com marcador antigo LIGADA: (dinheiro do banco, antes da migração): não apaga nem debita', async () => {
    banco.ar({ ...AR, status: 'LIQUIDADO', reconciled: true })
    banco.transacao({ id: 'x1', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1', source_text: 'LIGADA:itau:k1' })
    const { j } = await desfazer()
    expect(banco.tx_('x1')).toBeDefined()
    expect(banco.saldo(ACC)).toBe(100000)
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, balance_delta: 0, erros: [] }))
  })

  it('AR sem conta bancária: só volta o status', async () => {
    banco.ar({ ...AR, account_id: null, status: 'LIQUIDADO', reconciled: true })
    expect((await desfazer()).j.data.updated).toBe(1)
    expect(ar()).toEqual(expect.objectContaining({ status: 'RECEBIDO', reconciled: false }))
  })
})

describe('§5 Conferir: o que já é dinheiro desta AR (existing) e as regras antes de criar/ligar', () => {
  it('#4: crédito da antecipação (AR:id:anticipation) já no saldo → só LIQUIDADO, sem 2º crédito', async () => {
    banco.ar({ ...AR, received_amount: 96000, total_amount: 100000 })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 96000, bank_ref: 'AR:a1:anticipation' })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, balance_delta: 0, erros: [] }))
    expect(creditosAR()).toEqual([])
    expect(ar().status).toBe('LIQUIDADO')
  })

  it('#4: crédito do retorno CNAB (cnab:<nossoNumero> do pix_code) já no saldo → só LIQUIDADO', async () => {
    banco.ar({ ...AR, pix_code: JSON.stringify({ boletoStatus: 'PAID', nossoNumero: '123' }) })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'cnab:123' })
    expect((await conferir()).j.data.balance_delta).toBe(0)
    expect(creditosAR()).toEqual([])
  })

  it('linha BANCO convertida de um nocional da AR (linked_ref do adquirente) conta como existing', async () => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'rede', external_id: 'N1' })
    linhaLivro({ linked_ref: 'acquirer:rede:N1', amount: 14500 })
    linhaLivro({ id: 't2', bank_ref: 'ITAU:k2' }) // livre, mesmo valor da AR: não é usada
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, balance_delta: 0, ligadas: 0 }))
    expect(banco.tx_('t2')!.linked_ref).toBeNull()
    expect(creditosAR()).toEqual([])
  })

  it('#5 (i): original agrupada (received 0) → erro "conta agrupada — confira a agrupadora"; a agrupadora segue normal', async () => {
    banco.ar({ ...AR, id: 'G', received_amount: 50000, total_amount: 50000, group_id: 'g1' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:G' })
    banco.ar({ ...AR, id: 'A', received_amount: 0, total_amount: 30000, grouped_into_id: 'G', group_id: 'g1' })
    banco.ar({ ...AR, id: 'B', received_amount: null, total_amount: 20000, grouped_into_id: 'G', group_id: 'g1' })
    const { j } = await conferir(['G', 'A', 'B'])
    expect(j.data.erros).toEqual([{ ar: 'A', motivo: 'conta agrupada — confira a agrupadora' }, { ar: 'B', motivo: 'conta agrupada — confira a agrupadora' }])
    expect(j.data.updated).toBe(1)
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar('A').status).toBe('RECEBIDO')
  })

  it('#6 (ii): cobrança Asaas CONFIRMED sem crédito pay_ ainda → erro, nada criado; com vínculo explícito, liga', async () => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'CONFIRMED' })
    const { j } = await conferir()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'cobrança Asaas: o crédito entra pelo webhook quando o dinheiro cair' }])
    expect(banco.tabelas.transaction).toEqual([])
    expect(ar().status).toBe('RECEBIDO')
    linhaLivro()
    expect((await conferir(['a1'], { a1: 't1' })).j.data).toEqual(expect.objectContaining({ ligadas: 1, erros: [] }))
  })

  it('#6: com o crédito pay_ já lançado pelo webhook → só LIQUIDADO', async () => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 14600, bank_ref: 'pay_x' })
    expect((await conferir()).j.data).toEqual(expect.objectContaining({ updated: 1, balance_delta: 0, erros: [] }))
  })

  it('#7 (iii) SWAP: nocional AR:id + vínculo explícito a linha BANCO livre → apaga o nocional, liga a linha; saldo = banco', async () => {
    banco.tabelas.account[0].current_balance = 180000 // banco 100000 + 80000; o ERP contou 2x (nocional + linha CRIADA)
    banco.ar({ ...AR, received_amount: 80000, total_amount: 80000 })
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 80000, bank_ref: 'AR:a1', transaction_date: diaRel(-4) })
    linhaLivro({ amount: 80000 })
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 1, balance_delta: -80000, erros: [] }))
    expect(banco.tx_('noc')).toBeUndefined()
    expect(banco.tx_('t1')!.linked_ref).toBe('AR:a1')
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar().status).toBe('LIQUIDADO')
  })

  it('SWAP recusado: explícito inválido (valor difere) → erro do vínculo, nocional e saldo intocados', async () => {
    banco.ar({ ...AR, received_amount: 80000, total_amount: 80000 })
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 80000, bank_ref: 'AR:a1' })
    linhaLivro({ amount: 50000 })
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'Valor do lançamento difere mais de R$ 1,00 da baixa' }])
    expect(banco.tx_('noc')).toBeDefined()
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('vínculo explícito e a AR já tem dinheiro real (linha BANCO ligada): "já tem lançamento"', async () => {
    banco.ar(AR)
    linhaLivro({ id: 'ja', bank_ref: 'ITAU:k0', linked_ref: 'AR:a1' })
    linhaLivro()
    expect((await conferir(['a1'], { a1: 't1' })).j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta a receber já tem lançamento; vínculo não feito' }])
    expect(banco.tx_('t1')!.linked_ref).toBeNull()
  })

  it('#7 (iv): nocional sem vínculo explícito → só LIQUIDADO + aviso de linha do banco livre de mesmo valor', async () => {
    banco.ar(AR)
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    linhaLivro()
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, balance_delta: 0, erros: [] }))
    expect(j.data.avisos).toEqual([{ ar: 'a1', motivo: 'há linha do banco livre de mesmo valor — vincule pelo Extrato' }])
    expect(banco.tx_('t1')!.linked_ref).toBeNull()
  })

  it('nocional sem linha livre: só LIQUIDADO, sem aviso', async () => {
    banco.ar(AR)
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    expect((await conferir()).j.data.avisos).toEqual([])
  })

  it('crédito AR:id já compensado por :estorno não é "existing": a linha do banco livre é ligada', async () => {
    banco.ar(AR)
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 15000, bank_ref: 'AR:a1:estorno' })
    linhaLivro()
    expect((await conferir()).j.data.ligadas).toBe(1)
    expect(banco.tx_('t1')!.linked_ref).toBe('AR:a1')
  })
})

describe('§7: trava contas → AR, relê e escreve pelo tx (E1, #9, #10)', () => {
  const ACC2 = 'acc2'
  it('Conferir: trava a conta da AR e as contas dos lançamentos dela (em ordem), depois a AR; nada pelo cliente de fora', async () => {
    banco.conta({ id: ACC2 })
    banco.ar(AR)
    banco.transacao({ account_id: ACC2, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    await conferir()
    expect(banco.travas.map((t) => [t.tabela, t.id])).toEqual([['accounts', ACC], ['accounts', ACC2], ['accounts_receivable', 'a1']])
    const depois = banco.travas[2].seq
    expect(banco.log.filter((o) => o.dentroDaTx && o.modelo !== '$queryRaw').every((o) => o.seq > depois)).toBe(true)
    expect(banco.prismaDentroDaTx()).toEqual([])
  })

  it('Desfazer: mesma ordem (accounts antes da AR)', async () => {
    banco.ar({ ...AR, status: 'LIQUIDADO', reconciled: true })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    await desfazer()
    expect(banco.travas.map((t) => t.tabela)).toEqual(['accounts', 'accounts_receivable'])
  })

  it('E1: Receber comitado enquanto esperava a trava → o crédito aparece na releitura: só LIQUIDADO, nada criado nem ligado', async () => {
    banco.ar(AR)
    linhaLivro()
    banco.aoTravar(({ tabela }) => {
      if (tabela === 'accounts_receivable') banco.transacao({ id: 'x1', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 0, balance_delta: 0, erros: [] }))
    expect(banco.tx_('t1')!.linked_ref).toBeNull()
    expect(creditosAR()).toHaveLength(1)
  })

  it('#9: linha do livro comitada enquanto esperava a trava da conta → Conferir a vê e liga (não cria 2x)', async () => {
    banco.ar(AR)
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts') return
      linhaLivro()
      banco.aoTravar(null)
    })
    expect((await conferir()).j.data.ligadas).toBe(1)
    expect(creditosAR()).toEqual([])
  })

  it('Desfazer concorrente com Conferir: o crédito do Conferir aparece na releitura → apaga e debita', async () => {
    banco.ar({ ...AR, status: 'LIQUIDADO', reconciled: true })
    banco.aoTravar(({ tabela }) => {
      if (tabela === 'accounts_receivable') banco.transacao({ id: 'x1', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    })
    const { j } = await desfazer()
    expect(banco.tx_('x1')).toBeUndefined()
    expect(j.data.balance_delta).toBe(-15000)
  })

  it('conta bancária da AR trocada enquanto esperava a trava → erros "conta alterada — repita", nada gravado', async () => {
    banco.conta({ id: 'acc7' })
    banco.ar(AR)
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_receivable') ar().account_id = 'acc7' })
    const { j } = await conferir()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta alterada — repita' }])
    expect(ar().status).toBe('RECEBIDO')
    expect(banco.tabelas.transaction).toEqual([])
  })

  it('AR excluída enquanto esperava a trava: vai em erros, nada gravado', async () => {
    banco.ar(AR)
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_receivable') ar().deleted_at = new Date() })
    for (const reconciled of [true, false]) {
      Object.assign(ar(), { deleted_at: null, status: reconciled ? 'RECEBIDO' : 'LIQUIDADO', reconciled: !reconciled })
      const { j } = await post({ ids: ['a1'], reconciled })
      expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta a receber não encontrada' }])
    }
    expect(banco.tabelas.transaction).toEqual([])
  })
})

describe('§8: erros por AR nunca derrubam o lote (resolve #16, m9)', () => {
  it('#16: exceção inesperada numa AR (ex.: deadlock P2034) vai em erros, é desfeita, e o lote segue — 200 com o contrato', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    banco.ar({ ...AR, id: 'x' })
    banco.ar(AR)
    banco.tx.transaction.create.mockImplementationOnce(async () => { throw Object.assign(new Error('deadlock detected'), { code: 'P2034' }) })
    const { status, j } = await conferir(['x', 'a1'])
    expect(status).toBe(200)
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, erros: [{ ar: 'x', motivo: 'erro ao conferir; tente de novo' }] }))
    expect(ar('x').status).toBe('RECEBIDO')
    expect(creditosAR('x')).toEqual([])
    expect(creditosAR('a1')).toHaveLength(1)
    expect(vi.mocked(logAudit)).toHaveBeenCalled()
  })

  it('cada AR roda numa $transaction com maxWait 10s e timeout 20s', async () => {
    banco.ar(AR)
    await conferir()
    expect(banco.transacoes.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }])
  })

  it('m9: corpo validado — ids com não-texto, vazio, > 200, reconciled ausente → 400 (antes: 500)', async () => {
    const casos: [unknown, string][] = [
      [{ ids: [123], reconciled: true }, 'ids deve ser uma lista de ids (texto)'],
      [{ ids: [], reconciled: true }, 'ids é obrigatório (array não vazio)'],
      [{ reconciled: true }, 'ids é obrigatório (array não vazio)'],
      [{ ids: Array.from({ length: 201 }, (_, i) => `a${i}`), reconciled: true }, 'Máximo 200 itens por operação'],
      [{ ids: ['a1'] }, 'reconciled é obrigatório (boolean true/false)'],
    ]
    for (const [corpo, msg] of casos) {
      const { status, j } = await post(corpo)
      expect(status).toBe(400)
      expect(j.error).toBe(msg)
    }
  })
})

describe('F2-I (m10, m13): Asaas RECEIVED sem crédito não é bloqueado', () => {
  it('Payment RECEIVED sem pay_ lançado e linha do banco livre → liga a linha', async () => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED' })
    linhaLivro({ bank_ref: 'ASAAS:PAY:pay_x' })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 1, erros: [] }))
    expect(banco.tx_('t1')!.linked_ref).toBe('AR:a1')
  })

  it('Payment RECEIVED sem pay_ e sem linha → cria o crédito como uma AR comum', async () => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED' })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, erros: [], balance_delta: 15000 }))
    expect(creditosAR()).toHaveLength(1)
  })
})

describe('F2-G (#13, m18): guardas do SWAP e do Desfazer', () => {
  it('#13: crédito AR:id com marcador LIGADA (dinheiro do banco) + vínculo explícito → "já tem lançamento", nada apagado', async () => {
    banco.ar(AR)
    banco.transacao({ id: 'lig', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1', source_text: 'LIGADA:ITAU:k1' })
    linhaLivro()
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta a receber já tem lançamento; vínculo não feito' }])
    expect(banco.tx_('lig')).toBeDefined()
    expect(banco.tx_('t1')!.linked_ref).toBeNull()
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('m18: SWAP com nocional numa conta não travada (apareceu enquanto esperava) → "conta alterada — repita", nada apagado', async () => {
    banco.conta({ id: 'acc2', current_balance: 0 })
    banco.ar({ ...AR, received_amount: 15000 })
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    linhaLivro()
    banco.aoTravar(({ tabela }) => {
      if (tabela === 'accounts_receivable') banco.transacao({ id: 'noc2', account_id: 'acc2', transaction_type: 'CREDIT', amount: 1, bank_ref: 'AR:a1' })
    })
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta alterada — repita' }])
    expect(banco.tx_('noc')).toBeDefined()
    expect(banco.tx_('noc2')).toBeDefined()
    expect(banco.saldo('acc2')).toBe(0)
  })

  it('m18: Desfazer com crédito vivo numa conta não travada → "conta alterada — repita", nada apagado', async () => {
    banco.conta({ id: 'acc2', current_balance: 0 })
    banco.ar({ ...AR, status: 'LIQUIDADO', reconciled: true })
    banco.aoTravar(({ tabela }) => {
      if (tabela === 'accounts_receivable') banco.transacao({ id: 'x2', account_id: 'acc2', transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    })
    const { j } = await desfazer()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'conta alterada — repita' }])
    expect(banco.tx_('x2')).toBeDefined()
    expect(banco.saldo('acc2')).toBe(0)
  })
})

describe('F2-J (m12): exceção inesperada por AR vai para error_logs', () => {
  it('logError recebe o erro e o contexto (rota, empresa, usuário, AR) — além do erros[] da resposta', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(logError).mockClear()
    banco.ar(AR)
    const falha = Object.assign(new Error('deadlock detected'), { code: 'P2034' })
    banco.tx.transaction.create.mockImplementationOnce(async () => { throw falha })
    const { j } = await conferir()
    expect(j.data.erros).toEqual([{ ar: 'a1', motivo: 'erro ao conferir; tente de novo' }])
    expect(vi.mocked(logError)).toHaveBeenCalledWith(falha, expect.objectContaining({
      url: '/api/financeiro/contas-receber/bulk-reconcile', company_id: 'c1', user_id: 'u1', params: { ar: 'a1', reconciled: true },
    }))
  })
})

