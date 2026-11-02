import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/financeiro/livro-baixa-db', async (importOriginal) => {
  const o = await importOriginal<typeof import('@/lib/financeiro/livro-baixa-db')>()
  return { ...o, hojeSP: vi.fn(o.hojeSP) }
})

import { POST } from './route'
import { hojeSP } from '@/lib/financeiro/livro-baixa-db'
import { banco } from '@/test-utils/banco-falso'

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
