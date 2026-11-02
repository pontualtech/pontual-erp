import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'

const CORTE = '2026-10-29'
const dia = (d: string) => new Date(`${d}T00:00:00.000Z`)
const post = async (linhas: unknown[], extra: Record<string, unknown> = {}) => {
  const res = await POST(new NextRequest('http://x/api/financeiro/livro/linhas', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account_id: 'acc1', corte: CORTE, linhas, ...extra }),
  }))
  return { status: res.status, j: await res.json() }
}
const CHAVE = 'ITAU:2026-11-01|PIX RECEBIDO FULANO|+50000|1'
const linha = (over: Record<string, unknown> = {}) => ({ chave: CHAVE, data: '2026-11-01', descricao: 'PIX RECEBIDO FULANO', valor_centavos: 50000, ...over })

beforeEach(() => {
  banco.reset()
  banco.categoriasPadrao()
  banco.conta({ id: 'acc1', current_balance: 50000 })
  // Ajuste do corte ANTES dos nocionais (o que existia antes dele já foi absorvido).
  banco.transacao({ id: 'aj', account_id: 'acc1', transaction_type: 'CREDIT', amount: 0, bank_ref: `AJUSTE:acc1:${CORTE}`, origin: 'AJUSTE', transaction_date: dia(CORTE) })
})

describe('§1 LIGAR converte o nocional na linha do banco (resolve #1, #2, #12)', () => {
  it('por links: o CREDIT AR:a1 vira a linha BANCO (origin, bank_ref = chave, linked_ref = AR:a1, data/texto do banco), sem mexer no saldo', async () => {
    banco.transacao({ id: 'n1', account_id: 'acc1', transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:a1', description: 'Recebimento: OS 1', transaction_date: dia('2026-10-31'), reconciled: true })
    const { status, j } = await post([linha({ links: ['AR:a1'], contraparte: 'FULANO DE TAL' })])
    expect(status).toBe(200)
    expect(j.data.resultados).toEqual([{ chave: CHAVE, acao: 'LIGAR', refs: ['AR:a1'] }])
    expect(banco.tx_('n1')).toEqual(expect.objectContaining({
      origin: 'BANCO', bank_ref: CHAVE, linked_ref: 'AR:a1', source_text: 'PIX RECEBIDO FULANO', counterparty: 'FULANO DE TAL',
      transaction_date: dia('2026-11-01'), description: 'Recebimento: OS 1 · banco: PIX RECEBIDO FULANO',
      category_id: 'cat:Receita a identificar', reconciled: true, amount: 50000,
    }))
    expect(banco.tx.account.update).not.toHaveBeenCalled()
    expect(banco.saldo('acc1')).toBe(50000)
    expect(banco.tabelas.transaction).toHaveLength(2) // nada criado
  })

  it('por links com 2 créditos para 1 linha: o 1º recebe a chave, o 2º chave#2; categoria própria é mantida', async () => {
    banco.transacao({ id: 'n1', account_id: 'acc1', transaction_type: 'CREDIT', amount: 30000, bank_ref: 'acquirer:rede:1', description: 'Maquininha 1', transaction_date: dia('2026-11-01'), category_id: 'cat:Venda de Servicos' })
    banco.transacao({ id: 'n2', account_id: 'acc1', transaction_type: 'CREDIT', amount: 20000, bank_ref: 'acquirer:rede:2', description: 'Maquininha 2', transaction_date: dia('2026-11-01') })
    const { j } = await post([linha({ links: ['acquirer:rede:1', 'acquirer:rede:2'] })])
    expect(j.data.resultados[0].acao).toBe('LIGAR')
    expect(banco.tx_('n1')).toEqual(expect.objectContaining({ bank_ref: CHAVE, linked_ref: 'acquirer:rede:1', origin: 'BANCO', category_id: 'cat:Venda de Servicos' }))
    expect(banco.tx_('n2')).toEqual(expect.objectContaining({ bank_ref: `${CHAVE}#2`, linked_ref: 'acquirer:rede:2', origin: 'BANCO', category_id: 'cat:Receita a identificar' }))
    expect(banco.saldo('acc1')).toBe(50000)
  })

  it('órfão: o DEBIT AP:p1 vira a linha BANCO (linked_ref = AP:p1), categoria fallback "A classificar"', async () => {
    banco.transacao({ id: 'n1', account_id: 'acc1', transaction_type: 'DEBIT', amount: 48000, bank_ref: 'AP:p1', description: 'Pgto: Luz', transaction_date: dia('2026-10-31') })
    const chave = 'ITAU:2026-11-01|ELETROPAULO|-48000|1'
    const { j } = await post([{ chave, data: '2026-11-01', descricao: 'ELETROPAULO', valor_centavos: -48000 }])
    expect(j.data.resultados).toEqual([{ chave, acao: 'LIGAR', refs: ['n1'], origem: 'orfao' }])
    // Sem categoria própria, vale a da regra inicial (ELETROPAULO → Energia).
    expect(banco.tx_('n1')).toEqual(expect.objectContaining({
      origin: 'BANCO', bank_ref: chave, linked_ref: 'AP:p1', source_text: 'ELETROPAULO', transaction_date: dia('2026-11-01'),
      description: 'Pgto: Luz · banco: ELETROPAULO', reconciled: true,
    }))
    const energia = banco.tabelas.category.find((c) => c.name === 'Energia')!.id
    expect(banco.tx_('n1')!.category_id).toBe(energia)
    expect(banco.tx.account.update).not.toHaveBeenCalled()
  })

  it('descrição que já tem " · banco: " não duplica', async () => {
    banco.transacao({ id: 'n1', account_id: 'acc1', transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:a1', description: 'LIQUIDACAO: OS 1 · banco: x', transaction_date: dia('2026-11-01') })
    await post([linha({ links: ['AR:a1'] })])
    expect(banco.tx_('n1')!.description).toBe('LIQUIDACAO: OS 1 · banco: x')
  })

  it('reenvio da mesma linha (e da chave#2) = IGNORAR "já lançada"; LIGADA:<chave> antiga também', async () => {
    banco.transacao({ id: 'n1', account_id: 'acc1', transaction_type: 'CREDIT', amount: 30000, bank_ref: 'acquirer:rede:1', transaction_date: dia('2026-11-01') })
    banco.transacao({ id: 'n2', account_id: 'acc1', transaction_type: 'CREDIT', amount: 20000, bank_ref: 'acquirer:rede:2', transaction_date: dia('2026-11-01') })
    await post([linha({ links: ['acquirer:rede:1', 'acquirer:rede:2'] })])
    banco.tx_('n1')!.bank_ref = 'outra' // só a chave#2 identifica a linha agora
    const { j } = await post([linha({ links: ['acquirer:rede:1', 'acquirer:rede:2'] })])
    expect(j.data.resultados).toEqual([{ chave: CHAVE, acao: 'IGNORAR', motivo: 'já lançada' }])
    // Compatibilidade até a migração (§9): marcador antigo.
    banco.transacao({ id: 'velha', account_id: 'acc1', transaction_type: 'CREDIT', amount: 100, bank_ref: 'AR:z', source_text: 'LIGADA:K-VELHA' })
    const r2 = await post([{ chave: 'K-VELHA', data: '2026-11-01', descricao: 'X', valor_centavos: 100 }])
    expect(r2.j.data.resultados).toEqual([{ chave: 'K-VELHA', acao: 'IGNORAR', motivo: 'já lançada' }])
  })

  it('CRIAR com parte ligada: a linha criada leva a chave e o ligado vira chave#2', async () => {
    banco.transacao({ id: 'n1', account_id: 'acc1', transaction_type: 'CREDIT', amount: 30000, bank_ref: 'AR:a1', transaction_date: dia('2026-11-01') })
    const { j } = await post([linha({ links: ['AR:a1'] })])
    expect(j.data.resultados[0]).toEqual(expect.objectContaining({ acao: 'CRIAR', valor_centavos: 20000 }))
    const criada = banco.tx_(j.data.resultados[0].transaction_id)!
    expect(criada).toEqual(expect.objectContaining({ bank_ref: CHAVE, origin: 'BANCO', amount: 20000 }))
    expect(banco.tx_('n1')).toEqual(expect.objectContaining({ bank_ref: `${CHAVE}#2`, linked_ref: 'AR:a1', origin: 'BANCO' }))
    expect(banco.saldo('acc1')).toBe(70000)
  })

  it('ref já convertida por outra linha não é tomada de novo (links): a 2ª linha CRIA', async () => {
    banco.transacao({ id: 'n1', account_id: 'acc1', transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:a1', transaction_date: dia('2026-11-01') })
    await post([linha({ links: ['AR:a1'] })])
    const outra = 'ITAU:2026-11-01|PIX RECEBIDO FULANO|+50000|2'
    const { j } = await post([linha({ chave: outra, links: ['AR:a1'] })])
    expect(j.data.resultados[0]).toEqual(expect.objectContaining({ acao: 'CRIAR', valor_centavos: 50000 }))
    expect(banco.saldo('acc1')).toBe(100000)
  })

  it('a conversão roda dentro da tx travada (conta primeiro) e sem o cliente de fora', async () => {
    banco.transacao({ id: 'n1', account_id: 'acc1', transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:a1', transaction_date: dia('2026-11-01') })
    await post([linha({ links: ['AR:a1'] })])
    expect(banco.travas[0]).toEqual(expect.objectContaining({ tabela: 'accounts', id: 'acc1' }))
    const conversao = banco.log.find((o) => o.modelo === 'transaction' && (o.op === 'updateMany' || o.op === 'update') && o.args.data?.origin === 'BANCO')!
    expect(conversao.cliente).toBe('tx')
    expect(conversao.seq).toBeGreaterThan(banco.travas[0].seq)
    expect(banco.prismaDentroDaTx()).toEqual([])
  })

  it('simular não converte nada', async () => {
    banco.transacao({ id: 'n1', account_id: 'acc1', transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:a1', transaction_date: dia('2026-11-01') })
    const { j } = await post([linha({ links: ['AR:a1'] })], { simular: true })
    expect(j.data.resultados[0].acao).toBe('LIGAR')
    expect(banco.tx_('n1')).toEqual(expect.objectContaining({ bank_ref: 'AR:a1', origin: null }))
  })
})
