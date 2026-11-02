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
import { POST as lancarLinhas } from '@/app/api/financeiro/livro/linhas/route'
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

  it('#6 (ii) / F7-E: cobrança Asaas CONFIRMED sem crédito pay_ ainda → só status + aviso, nada criado; com vínculo explícito, liga', async () => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'CONFIRMED' })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ erros: [], avisos: [{ ar: 'a1', motivo: 'pagamento Asaas ainda não creditado/em disputa: o dinheiro entra pela linha do extrato' }] }))
    expect(banco.tabelas.transaction).toEqual([])
    expect(ar().status).toBe('LIQUIDADO')
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

describe('F3-F (#7): Conferir de AR com Payment Asaas RECEIVED sem crédito pay_ faz o que o webhook faria', () => {
  const ASAAS = '99999999-9999-4999-8999-999999999999'
  const recebido = (over: Record<string, unknown> = {}) => banco.pagamento({
    receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED', amount: 15000, billing_type: 'PIX', ...over,
  })
  const comRef = (ref: string) => banco.tabelas.transaction.filter((t) => t.bank_ref === ref || t.linked_ref === ref)

  it('(1) linha ASAAS:PAY:<pay> livre (líquida, valor ≠ bruto) → liga com linked_ref = pay, categoria da AR, sem saldo; nada de AR:id', async () => {
    banco.ar(AR)
    recebido()
    linhaLivro({ bank_ref: 'ASAAS:PAY:pay_x', amount: 14550 })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 1, balance_delta: 0, erros: [] }))
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({
      linked_ref: 'pay_x', category_id: 'cat:Venda de Servicos', reconciled: true, description: 'LIQUIDACAO: OS 1 · banco: PIX CLIENTE',
    }))
    expect(creditosAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'LIQUIDADO', reconciled: true }))
  })

  it('(1) linha ASAAS:PAY noutra conta (a do Asaas, não a da AR): a conta dela é travada antes e a linha é ligada', async () => {
    banco.conta({ id: ASAAS, current_balance: 50000 })
    banco.ar(AR)
    recebido()
    linhaLivro({ account_id: ASAAS, bank_ref: 'ASAAS:PAY:pay_x', amount: 14550 })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ ligadas: 1, erros: [] }))
    expect(banco.tx_('t1')!.linked_ref).toBe('pay_x')
    expect(banco.travas.filter((t) => t.tabela === 'accounts').map((t) => t.id).sort()).toEqual([ACC, ASAAS].sort())
    expect(banco.saldo(ASAAS)).toBe(50000)
  })

  it('(1) linha ASAAS:PAY já categorizada (Venda de Servicos) mantém a sua categoria', async () => {
    banco.ar({ ...AR, category_id: 'cat:Outra Receita' })
    banco.categoria('Outra Receita')
    recebido()
    linhaLivro({ bank_ref: 'ASAAS:PAY:pay_x', amount: 14550, category_id: 'cat:Venda de Servicos' })
    await conferir()
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: 'pay_x', category_id: 'cat:Venda de Servicos' }))
  })
})

describe('F4-B / F6-B: Asaas RECEIVED sem crédito — liga a linha do extrato; o Conferir nunca cria dinheiro Asaas', () => {
  const ASAAS = '99999999-9999-4999-8999-999999999999'
  const AVISO = 'pagamento Asaas sem lançamento: o dinheiro entra pela linha do extrato Asaas (ou já está no ajuste de caixa, se anterior ao corte)'
  const recebido = (over: Record<string, unknown> = {}) => banco.pagamento({
    receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED', amount: 15000, billing_type: 'PIX',
    paid_at: new Date('2026-10-01T15:00:00Z'), ...over,
  })
  const comRef = (ref: string) => banco.tabelas.transaction.filter((t) => t.bank_ref === ref || t.linked_ref === ref)

  it('#2: pagamento ANTES do corte (paid_at 10/09), sem linha → nada criado, saldo intocado, LIQUIDADO com aviso', async () => {
    banco.ar(AR)
    recebido({ paid_at: new Date('2026-09-10T15:00:00Z') })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 0, balance_delta: 0, erros: [], avisos: [{ ar: 'a1', motivo: AVISO }] }))
    expect(comRef('pay_x')).toEqual([])
    expect(creditosAR()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ar()).toEqual(expect.objectContaining({ status: 'LIQUIDADO', reconciled: true }))
  })

  it('pós-corte sem linha → idem (o dinheiro entra pela linha do extrato); a linha que chega depois nasce ligada ao pay_x (F6-A)', async () => {
    banco.conta({ id: ASAAS, name: 'ASSAS', provider_config: { provider: 'asaas' }, current_balance: 0 })
    const CORTE = '2026-10-29'
    banco.transacao({ id: 'aj', account_id: ASAAS, transaction_type: 'CREDIT', amount: 0, bank_ref: `AJUSTE:${ASAAS}:${CORTE}`, origin: 'AJUSTE', transaction_date: diaRel(-5) })
    banco.ar(AR)
    recebido({ paid_at: new Date() })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ balance_delta: 0, avisos: [{ ar: 'a1', motivo: AVISO }] }))
    expect(comRef('pay_x')).toEqual([])
    const res = await lancarLinhas(new NextRequest('http://x/api/financeiro/livro/linhas', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: ASAAS, corte: CORTE, linhas: [{ chave: 'ASAAS:PAY:pay_x', data: hoje, descricao: 'Cobrança recebida', valor_centavos: 14801, links: ['pay_x'] }] }),
    }))
    expect((await res.json()).data.resultados[0]).toEqual(expect.objectContaining({ acao: 'CRIAR', vinculo: 'pay_x' }))
    expect(comRef('pay_x')).toEqual([expect.objectContaining({ account_id: ASAAS, origin: 'BANCO', linked_ref: 'pay_x', amount: 14801 })])
    expect([banco.saldo(ACC), banco.saldo(ASAAS)]).toEqual([100000, 14801])
  })

  it('m9: AR SEM conta → só status + aviso (sem erro, sem crédito)', async () => {
    banco.ar({ ...AR, account_id: null })
    recebido()
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, balance_delta: 0, erros: [], avisos: [{ ar: 'a1', motivo: AVISO }] }))
    expect(banco.tabelas.transaction).toEqual([])
    expect(ar()).toEqual(expect.objectContaining({ status: 'LIQUIDADO', reconciled: true }))
  })

  it('m9: AR sem conta e linha ASAAS:PAY livre → liga com pay_x', async () => {
    banco.conta({ id: ASAAS, name: 'ASSAS', provider_config: { provider: 'asaas' }, current_balance: 0 })
    banco.ar({ ...AR, account_id: null })
    recebido()
    linhaLivro({ account_id: ASAAS, bank_ref: 'ASAAS:PAY:pay_x', amount: 14550 })
    expect((await conferir()).j.data).toEqual(expect.objectContaining({ ligadas: 1, erros: [] }))
    expect(banco.tx_('t1')!.linked_ref).toBe('pay_x')
  })

  it('#2/m8/m16: livro[ar] = a linha ASAAS:PAY:<pay> (cartão, Δ > R$ 1) → liga com linked_ref = pay_x, sem comparar bruto × líquido', async () => {
    banco.ar(AR)
    recebido({ billing_type: 'CREDIT_CARD' })
    linhaLivro({ bank_ref: 'ASAAS:PAY:pay_x', amount: 14400 })
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 1, balance_delta: 0, erros: [] }))
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: 'pay_x', reconciled: true }))
    expect(creditosAR()).toEqual([])
  })

  it('livro[ar] = outra linha (PIX no Itaú, mesmo valor) → segue o caminho explícito de antes (liga como AR:a1)', async () => {
    banco.ar(AR)
    recebido()
    linhaLivro()
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data).toEqual(expect.objectContaining({ ligadas: 1, erros: [] }))
    expect(banco.tx_('t1')!.linked_ref).toBe('AR:a1')
  })

  it('m15: dois pagamentos RECEIVED — um com linha ASAAS:PAY (liga) e outro sem (nada criado, aviso); delta 0', async () => {
    banco.ar({ ...AR, total_amount: 30000, received_amount: 30000 })
    recebido()
    recebido({ external_id: 'pay_y', amount: 15000 })
    linhaLivro({ bank_ref: 'ASAAS:PAY:pay_x', amount: 14550 })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 1, balance_delta: 0, erros: [], avisos: [{ ar: 'a1', motivo: AVISO }] }))
    expect(banco.tx_('t1')!.linked_ref).toBe('pay_x')
    expect(comRef('pay_y')).toEqual([])
  })

  it('m10: livro[ar] = linha ASAAS:PAY e a AR já tem o nocional AR:a1 do Receber manual na mesma conta → liga pay_x + SWAP (sem bruto × líquido)', async () => {
    banco.ar(AR)
    recebido({ billing_type: 'CREDIT_CARD' })
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    banco.tabelas.account[0].current_balance = 115000
    linhaLivro({ bank_ref: 'ASAAS:PAY:pay_x', amount: 14400 })
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 1, balance_delta: -15000, erros: [] }))
    expect(banco.tx_('t1')!.linked_ref).toBe('pay_x')
    expect(banco.tx_('noc')).toBeUndefined()
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('m13: portão do CONFIRMED — AR com um Payment RECEIVED e outro CONFIRMED, sem dinheiro → só status + aviso, nada criado', async () => {
    banco.ar(AR)
    recebido()
    recebido({ external_id: 'pay_c', status: 'CONFIRMED' })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ erros: [], avisos: [{ ar: 'a1', motivo: 'pagamento Asaas ainda não creditado/em disputa: o dinheiro entra pela linha do extrato' }] }))
    expect(banco.tabelas.transaction).toEqual([])
  })
})

describe('m13 (desvio aceito): Payment Asaas PENDING/OVERDUE sem crédito não bloqueia o Conferir', () => {
  // Link do Asaas não usado — o cliente pagou por PIX direto; a linha do banco é o dinheiro e é ligada pelo valor.
  it.each(['PENDING', 'OVERDUE'])('%s: liga a linha do banco livre de mesmo valor', async (status) => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status })
    linhaLivro()
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 1, erros: [] }))
    expect(banco.tx_('t1')!.linked_ref).toBe('AR:a1')
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

describe('F3-B: Conferir usa o mesmo dinheiro líquido de estorno/chargeback', () => {
  it('pay_x revertido por inteiro (CREDIT 14550 − DEBIT pay_x-refund 15000) não é "existing": o Conferir cria o crédito', async () => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'REFUNDED' })
    banco.transacao({ account_id: ACC, transaction_type: 'CREDIT', amount: 14550, bank_ref: 'pay_x' })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 15000, bank_ref: 'pay_x-refund' })
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, balance_delta: 15000, erros: [] }))
    expect(creditosAR()).toHaveLength(1)
  })
})

describe('F7-A (#1): Conferir só troca nocional posterior ao ajuste de caixa', () => {
  const ajuste = () => banco.transacao({ id: 'aj', account_id: ACC, transaction_type: 'CREDIT', amount: 0, origin: 'AJUSTE', bank_ref: `AJUSTE:${ACC}:2026-10-29`, created_at: new Date('2026-10-30T10:00:00Z') })

  it('(iii) livro[ar] = linha do Itaú e o nocional AR:a1 é anterior ao ajuste → liga a linha, o nocional fica, saldo intocado', async () => {
    banco.ar(AR)
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1', created_at: new Date('2026-10-28T15:00:00Z') })
    ajuste()
    linhaLivro()
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data).toEqual(expect.objectContaining({ ligadas: 1, balance_delta: 0, erros: [] }))
    expect(banco.tx_('t1')!.linked_ref).toBe('AR:a1')
    expect(banco.tx_('noc')).toBeDefined()
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('#3 (F8-B): Receber 28/10, ajuste 30/10, linha 31/10, Conferir livro[a1], Desfazer, Conferir → saldo = banco (o Desfazer não apaga o nocional absorvido)', async () => {
    banco.ar(AR)
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1', created_at: new Date('2026-10-28T15:00:00Z') })
    ajuste()
    linhaLivro()
    const BANCO = 100000 // saldo do ERP = banco depois do ajuste e da linha (o nocional foi absorvido pelo ajuste)
    expect((await conferir(['a1'], { a1: 't1' })).j.data).toEqual(expect.objectContaining({ ligadas: 1, balance_delta: 0, erros: [] }))
    expect(banco.saldo(ACC)).toBe(BANCO)
    expect((await desfazer()).j.data).toEqual(expect.objectContaining({ updated: 1, erros: [] }))
    expect(banco.tx_('noc')).toBeDefined()
    expect(banco.saldo(ACC)).toBe(BANCO)
    expect((await conferir()).j.data.erros).toEqual([])
    expect(banco.saldo(ACC)).toBe(BANCO)
  })

  it('Desfazer ainda apaga o nocional posterior ao ajuste (com o saldo)', async () => {
    banco.ar({ ...AR, status: 'LIQUIDADO', reconciled: true })
    ajuste()
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1', created_at: new Date() })
    banco.tabelas.account[0].current_balance = 115000
    expect((await desfazer()).j.data).toEqual(expect.objectContaining({ updated: 1, balance_delta: -15000 }))
    expect(banco.tx_('noc')).toBeUndefined()
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('(iii) nocional posterior ao ajuste → SWAP como antes', async () => {
    banco.ar(AR)
    ajuste()
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1', created_at: new Date() })
    banco.tabelas.account[0].current_balance = 115000
    linhaLivro()
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data).toEqual(expect.objectContaining({ ligadas: 1, balance_delta: -15000 }))
    expect(banco.tx_('noc')).toBeUndefined()
  })

  it('F6-B (livro[ar] = linha ASAAS:PAY) com nocional AR:a1 anterior ao ajuste → liga pay_x, o nocional fica', async () => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED', amount: 15000 })
    banco.transacao({ id: 'noc', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1', created_at: new Date('2026-10-28T15:00:00Z') })
    ajuste()
    linhaLivro({ bank_ref: 'ASAAS:PAY:pay_x', amount: 14400 })
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data).toEqual(expect.objectContaining({ ligadas: 1, balance_delta: 0 }))
    expect(banco.tx_('t1')!.linked_ref).toBe('pay_x')
    expect(banco.tx_('noc')).toBeDefined()
  })
})

describe('F8-E (m5/m6): F6-B com livro[ar] = linha ASAAS:PAY e dinheiro da AR em OUTRA conta → erro, como produção', () => {
  const ASSAS = '99999999-9999-4999-8999-999999999999'
  const CAIXA = '33333333-3333-4333-8333-333333333333'

  it('nocional AR:a1 vivo no Caixa (Receber manual) → erros "há dinheiro desta conta em Caixa; confira antes de ligar"; nada gravado', async () => {
    banco.conta({ id: ASSAS, name: 'ASSAS', current_balance: 0 })
    banco.conta({ id: CAIXA, name: 'Caixa', current_balance: 15000 })
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED', amount: 15000 })
    banco.transacao({ id: 'noc', account_id: CAIXA, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    linhaLivro({ account_id: ASSAS, bank_ref: 'ASAAS:PAY:pay_x', amount: 14550 })
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data).toEqual(expect.objectContaining({ updated: 0, ligadas: 0, erros: [{ ar: 'a1', motivo: 'há dinheiro desta conta em Caixa; confira antes de ligar' }] }))
    expect(banco.tx_('t1')!.linked_ref).toBeNull()
    expect(banco.tx_('noc')).toBeDefined()
    expect(ar().status).toBe('RECEBIDO')
  })

  it('o nocional na MESMA conta da linha continua sendo o SWAP (m10)', async () => {
    banco.conta({ id: ASSAS, name: 'ASSAS', current_balance: 15000 })
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED', amount: 15000 })
    banco.transacao({ id: 'noc', account_id: ASSAS, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1' })
    linhaLivro({ account_id: ASSAS, bank_ref: 'ASAAS:PAY:pay_x', amount: 14550 })
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data).toEqual(expect.objectContaining({ ligadas: 1, erros: [] }))
    expect(banco.tx_('noc')).toBeUndefined()
  })
})

describe('F7-C (#6): Desfazer desliga a linha e o Conferir seguinte a RELIGA', () => {
  it('linha ligada a AR:a1 de 40 dias atrás → Desfazer → Conferir → religa (sem crédito novo)', async () => {
    banco.ar({ ...AR, status: 'LIQUIDADO', reconciled: true })
    linhaLivro({ linked_ref: 'AR:a1', category_id: 'cat:Venda de Servicos', transaction_date: diaRel(-40) })
    expect((await desfazer()).j.data.updated).toBe(1)
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: null, desligada_de: 'AR:a1' }))
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ ligadas: 1, balance_delta: 0, erros: [] }))
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: 'AR:a1', desligada_de: null }))
    expect(creditosAR()).toEqual([])
  })
})

describe('F7-C: o F6-B zera desligada_de ao ligar a linha ASAAS:PAY', () => {
  it('linha ASAAS:PAY livre com desligada_de → ligada ao pay_x e desligada_de null', async () => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED', amount: 15000 })
    linhaLivro({ bank_ref: 'ASAAS:PAY:pay_x', amount: 14550, desligada_de: 'AR:a1' })
    await conferir()
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: 'pay_x', desligada_de: null }))
  })
})

describe('F7-E (#5): Conferir não cria dinheiro para AR Asaas em trânsito', () => {
  it.each(['DISPUTED', 'REFUND_PENDING', 'AWAITING_RISK_ANALYSIS'])('Payment %s sem crédito → só status + aviso, nenhum CREDIT', async (status) => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_c', status })
    linhaLivro() // linha livre de mesmo valor: não é este dinheiro
    const { j } = await conferir()
    expect(j.data).toEqual(expect.objectContaining({ updated: 1, ligadas: 0, balance_delta: 0, avisos: [{ ar: 'a1', motivo: 'pagamento Asaas ainda não creditado/em disputa: o dinheiro entra pela linha do extrato' }] }))
    expect(creditosAR()).toEqual([])
    expect(banco.tx_('t1')!.linked_ref).toBeNull()
    expect(ar().status).toBe('LIQUIDADO')
  })

  it.each(['PENDING', 'OVERDUE', 'DELETED', 'CANCELLED', 'REFUNDED', 'EXPIRED'])('Payment %s (sem dinheiro a caminho) não bloqueia: cria como antes', async (status) => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_c', status })
    const { j } = await conferir()
    expect(j.data.balance_delta).toBe(15000)
    expect(creditosAR()).toHaveLength(1)
  })
})

describe('F7-G (m12): o SWAP do F6-B não apaga o crédito com marcador LIGADA (dinheiro do banco)', () => {
  it('livro[ar] = linha ASAAS:PAY + crédito AR:a1 com source_text LIGADA:… na mesma conta → liga pay_x e o LIGADA fica', async () => {
    banco.ar(AR)
    banco.pagamento({ receivable_id: 'a1', provider: 'asaas', external_id: 'pay_x', status: 'RECEIVED', amount: 15000 })
    banco.transacao({ id: 'lig', account_id: ACC, transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a1', source_text: 'LIGADA:ITAU:k' })
    linhaLivro({ bank_ref: 'ASAAS:PAY:pay_x', amount: 14400 })
    const { j } = await conferir(['a1'], { a1: 't1' })
    expect(j.data).toEqual(expect.objectContaining({ ligadas: 1, balance_delta: 0 }))
    expect(banco.tx_('lig')).toBeDefined()
  })
})
