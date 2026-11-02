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
      // F2-C: nocional AR:<id> sem categoria recebe a receita padrão (antes: fallback 'Receita a identificar').
      category_id: 'cat:Venda de Servicos', reconciled: true, amount: 50000,
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
    expect(banco.tx_('n2')).toEqual(expect.objectContaining({ bank_ref: `${CHAVE}#2`, linked_ref: 'acquirer:rede:2', origin: 'BANCO', category_id: 'cat:Venda de Servicos' }))
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

  it('F2-C (#2): TRANSFER sem categoria convertida → "Transferência entre contas" (fora do total), não fallback', async () => {
    banco.transacao({ id: 'tr', account_id: 'acc1', transaction_type: 'DEBIT', amount: 1000000, bank_ref: 'TRANSFER:cr1', description: 'Transferência para B', transaction_date: dia('2026-11-01') })
    const chave = 'ITAU:2026-11-01|TED ENVIADA|-1000000|1'
    const { j } = await post([{ chave, data: '2026-11-01', descricao: 'TED ENVIADA', valor_centavos: -1000000 }])
    expect(j.data.resultados[0]).toEqual(expect.objectContaining({ acao: 'LIGAR', origem: 'orfao' }))
    expect(banco.tx_('tr')!.category_id).toBe('cat:Transferência entre contas')
  })

  it('F2-C (#6): pay_/cnab:/antecipação sem categoria → receita padrão; AP:<id> → categoria da AP (sem ela, regra/"A classificar")', async () => {
    banco.categoria('Aluguel', 'financeiro_despesa')
    banco.ap({ id: 'p1', category_id: 'cat:Aluguel' })
    for (const [id, ref] of [['a', 'pay_1'], ['b', 'cnab:9'], ['c', 'AR:x:anticipation']]) {
      banco.transacao({ id, account_id: 'acc1', transaction_type: 'CREDIT', amount: 100, bank_ref: ref, transaction_date: dia('2026-11-01') })
    }
    banco.transacao({ id: 'd', account_id: 'acc1', transaction_type: 'DEBIT', amount: 4800, bank_ref: 'AP:p1', transaction_date: dia('2026-11-01') })
    banco.transacao({ id: 'e', account_id: 'acc1', transaction_type: 'DEBIT', amount: 3300, bank_ref: 'AP:semcat', transaction_date: dia('2026-11-01') })
    await post([
      { chave: 'K1', data: '2026-11-01', descricao: 'ASAAS', valor_centavos: 100, links: ['pay_1'] },
      { chave: 'K2', data: '2026-11-01', descricao: 'INTER', valor_centavos: 100, links: ['cnab:9'] },
      { chave: 'K3', data: '2026-11-01', descricao: 'REDE', valor_centavos: 100, links: ['AR:x:anticipation'] },
      { chave: 'K4', data: '2026-11-01', descricao: 'ELETROPAULO', valor_centavos: -4800 },
      { chave: 'K5', data: '2026-11-01', descricao: 'BOLETO', valor_centavos: -3300 },
    ])
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => banco.tx_(id)!.category_id)).toEqual([
      'cat:Venda de Servicos', 'cat:Venda de Servicos', 'cat:Venda de Servicos', 'cat:Aluguel', 'cat:A classificar',
    ])
  })

  it('F3-G (m2, m15): DEBIT de estorno/reversão (AR:*:estorno, *-refund, *-chargeback) → "Estornos" (criada se faltar), não receita', async () => {
    for (const [id, ref] of [['e1', 'AR:x:estorno'], ['e2', 'pay_1-refund'], ['e3', 'pay_2-chargeback']]) {
      banco.transacao({ id, account_id: 'acc1', transaction_type: 'DEBIT', amount: 100, bank_ref: ref, transaction_date: dia('2026-11-01') })
    }
    const { j } = await post([
      { chave: 'K1', data: '2026-11-01', descricao: 'ESTORNO', valor_centavos: -100, links: ['AR:x:estorno'] },
      { chave: 'K2', data: '2026-11-01', descricao: 'ASAAS REEMBOLSO', valor_centavos: -100, links: ['pay_1-refund'] },
      { chave: 'K3', data: '2026-11-01', descricao: 'ASAAS CHARGEBACK', valor_centavos: -100, links: ['pay_2-chargeback'] },
    ])
    expect(j.data.resultados.map((r: { acao: string }) => r.acao)).toEqual(['LIGAR', 'LIGAR', 'LIGAR'])
    const estornos = banco.tabelas.category.find((c) => c.name === 'Estornos')
    expect(estornos).toEqual(expect.objectContaining({ module: 'financeiro_despesa' }))
    expect(['e1', 'e2', 'e3'].map((id) => banco.tx_(id)!.category_id)).toEqual([estornos!.id, estornos!.id, estornos!.id])
  })

  it('F3-G: receita padrão só para CREDIT — DEBIT acquirer:/pay_ sem sufixo de reversão segue regra/"A classificar"', async () => {
    banco.transacao({ id: 'd1', account_id: 'acc1', transaction_type: 'DEBIT', amount: 100, bank_ref: 'acquirer:rede:1', transaction_date: dia('2026-11-01') })
    banco.transacao({ id: 'c1', account_id: 'acc1', transaction_type: 'CREDIT', amount: 100, bank_ref: 'acquirer:rede:2', transaction_date: dia('2026-11-01') })
    // CREDIT com sufixo de reversão (ex.: devolução de um reembolso) também não é receita padrão.
    banco.transacao({ id: 'c2', account_id: 'acc1', transaction_type: 'CREDIT', amount: 100, bank_ref: 'pay_3-refund', transaction_date: dia('2026-11-01') })
    await post([
      { chave: 'K1', data: '2026-11-01', descricao: 'REDE', valor_centavos: -100, links: ['acquirer:rede:1'] },
      { chave: 'K2', data: '2026-11-01', descricao: 'REDE', valor_centavos: 100, links: ['acquirer:rede:2'] },
      { chave: 'K3', data: '2026-11-01', descricao: 'ASAAS', valor_centavos: 100, links: ['pay_3-refund'] },
    ])
    expect(['d1', 'c1', 'c2'].map((id) => banco.tx_(id)!.category_id)).toEqual(['cat:A classificar', 'cat:Venda de Servicos', 'cat:Receita a identificar'])
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

  it('§10: a decisão usa a releitura do tx — linha lançada por outra chamada enquanto esperava a trava da conta → IGNORAR (não cria 2x)', async () => {
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts') return
      banco.transacao({ account_id: 'acc1', transaction_type: 'CREDIT', amount: 50000, origin: 'BANCO', bank_ref: CHAVE, transaction_date: dia('2026-11-01') })
      banco.aoTravar(null)
    })
    const { j } = await post([linha()])
    expect(j.data.resultados).toEqual([{ chave: CHAVE, acao: 'IGNORAR', motivo: 'já lançada' }])
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === CHAVE)).toHaveLength(1)
    expect(banco.saldo('acc1')).toBe(50000)
  })

  it('simular não converte nada', async () => {
    banco.transacao({ id: 'n1', account_id: 'acc1', transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:a1', transaction_date: dia('2026-11-01') })
    const { j } = await post([linha({ links: ['AR:a1'] })], { simular: true })
    expect(j.data.resultados[0].acao).toBe('LIGAR')
    expect(banco.tx_('n1')).toEqual(expect.objectContaining({ bank_ref: 'AR:a1', origin: null }))
  })
})

describe('§2 órfão nunca é o par do estorno (resolve #3)', () => {
  // Receber AR 150 em 03/11 e estornar em 04/11: CREDIT AR:a + DEBIT AR:a:estorno (líquido 0, banco intocado).
  const parEstornado = () => {
    banco.transacao({ id: 'cr', account_id: 'acc1', transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a', transaction_date: dia('2026-11-03') })
    banco.transacao({ id: 'es', account_id: 'acc1', transaction_type: 'DEBIT', amount: 15000, bank_ref: 'AR:a:estorno', transaction_date: dia('2026-11-04') })
  }

  it('#3(a): saída real de 150 no dia do estorno CRIA (não liga ao DEBIT :estorno) → saldo cai 150', async () => {
    parEstornado()
    const chave = 'ITAU:2026-11-04|PIX ENVIADO FORNECEDOR|-15000|1'
    const { j } = await post([{ chave, data: '2026-11-04', descricao: 'PIX ENVIADO FORNECEDOR', valor_centavos: -15000 }])
    expect(j.data.resultados[0]).toEqual(expect.objectContaining({ acao: 'CRIAR', valor_centavos: -15000 }))
    expect(banco.tx_('es')).toEqual(expect.objectContaining({ origin: null, bank_ref: 'AR:a:estorno' }))
    expect(banco.saldo('acc1')).toBe(50000 - 15000)
  })

  it('#3(b): entrada real de 150 não liga ao CREDIT AR:a já estornado → CRIA', async () => {
    parEstornado()
    const chave = 'ITAU:2026-11-04|PIX RECEBIDO|+15000|1'
    const { j } = await post([{ chave, data: '2026-11-04', descricao: 'PIX RECEBIDO', valor_centavos: 15000 }])
    expect(j.data.resultados[0]).toEqual(expect.objectContaining({ acao: 'CRIAR', valor_centavos: 15000 }))
    expect(banco.tx_('cr')).toEqual(expect.objectContaining({ origin: null, bank_ref: 'AR:a' }))
    expect(banco.saldo('acc1')).toBe(65000)
  })

  it('AP: o CREDIT AP:p:estorno e o DEBIT AP:p já compensado também ficam de fora', async () => {
    banco.transacao({ id: 'db', account_id: 'acc1', transaction_type: 'DEBIT', amount: 120000, bank_ref: 'AP:p', transaction_date: dia('2026-11-03') })
    banco.transacao({ id: 'ce', account_id: 'acc1', transaction_type: 'CREDIT', amount: 120000, bank_ref: 'AP:p:estorno', transaction_date: dia('2026-11-03') })
    const { j } = await post([
      { chave: 'K1', data: '2026-11-03', descricao: 'BOLETO', valor_centavos: -120000 },
      { chave: 'K2', data: '2026-11-03', descricao: 'DEVOLUCAO', valor_centavos: 120000 },
    ])
    expect(j.data.resultados.map((r: any) => r.acao)).toEqual(['CRIAR', 'CRIAR'])
  })

  it('recebido de novo DEPOIS do estorno: o crédito novo é órfão válido (liga, não duplica)', async () => {
    parEstornado()
    banco.transacao({ id: 'cr2', account_id: 'acc1', transaction_type: 'CREDIT', amount: 15000, bank_ref: 'AR:a', transaction_date: dia('2026-11-04') })
    const chave = 'ITAU:2026-11-04|PIX RECEBIDO|+15000|1'
    const { j } = await post([{ chave, data: '2026-11-04', descricao: 'PIX RECEBIDO', valor_centavos: 15000 }])
    expect(j.data.resultados[0]).toEqual({ chave, acao: 'LIGAR', refs: ['cr2'], origem: 'orfao' })
    expect(banco.tx_('cr')).toEqual(expect.objectContaining({ origin: null }))
    expect(banco.saldo('acc1')).toBe(50000)
  })

  it('links para crédito já estornado: não liga (CRIA a linha)', async () => {
    parEstornado()
    const { j } = await post([{ chave: 'K', data: '2026-11-04', descricao: 'PIX', valor_centavos: 15000, links: ['AR:a'] }])
    expect(j.data.resultados[0]).toEqual(expect.objectContaining({ acao: 'CRIAR', valor_centavos: 15000 }))
    expect(banco.tx_('cr')).toEqual(expect.objectContaining({ origin: null, bank_ref: 'AR:a' }))
  })

  it('lançamento manual sem bank_ref continua sendo órfão válido', async () => {
    banco.transacao({ id: 'mn', account_id: 'acc1', transaction_type: 'DEBIT', amount: 9900, bank_ref: null, transaction_date: dia('2026-11-02') })
    const { j } = await post([{ chave: 'K', data: '2026-11-02', descricao: 'TARIFA', valor_centavos: -9900 }])
    expect(j.data.resultados[0]).toEqual({ chave: 'K', acao: 'LIGAR', refs: ['mn'], origem: 'orfao' })
  })
})

describe('F2-H (m1, m5, m11, m22): livro/linhas robusto para a rotina — erro por linha, nunca 500 do lote', () => {
  const L2 = { chave: 'K2', data: '2026-11-01', descricao: 'TARIFA', valor_centavos: -990 }

  it('m1: links com tipo incompatível com o sinal da linha → a linha vira erro e o lote segue', async () => {
    banco.transacao({ id: 'd1', account_id: 'acc1', transaction_type: 'DEBIT', amount: 30000, bank_ref: 'AP:p1', transaction_date: dia('2026-11-01') })
    const { status, j } = await post([{ chave: 'K1', data: '2026-11-01', descricao: 'PIX', valor_centavos: 30000, links: ['AP:p1'] }, L2])
    expect(status).toBe(200)
    expect(j.data.resultados[0]).toEqual({ chave: 'K1', acao: 'ERRO', erro: 'links com tipo incompatível com o sinal da linha' })
    expect(j.data.resultados[1]).toEqual(expect.objectContaining({ chave: 'K2', acao: 'CRIAR' }))
    expect(banco.tx_('d1')).toEqual(expect.objectContaining({ origin: null, bank_ref: 'AP:p1' }))
    expect(banco.saldo('acc1')).toBe(50000 - 990)
  })

  it('m1: linha de saída com links ao DEBIT de mesmo valor → LIGAR (não cria |v|+soma)', async () => {
    banco.transacao({ id: 'd1', account_id: 'acc1', transaction_type: 'DEBIT', amount: 30000, bank_ref: 'AP:p1', transaction_date: dia('2026-11-01') })
    const { j } = await post([{ chave: 'K1', data: '2026-11-01', descricao: 'BOLETO', valor_centavos: -30000, links: ['AP:p1'] }])
    expect(j.data.resultados[0]).toEqual({ chave: 'K1', acao: 'LIGAR', refs: ['AP:p1'] })
    expect(banco.tx_('d1')).toEqual(expect.objectContaining({ origin: 'BANCO', bank_ref: 'K1', linked_ref: 'AP:p1' }))
    expect(banco.saldo('acc1')).toBe(50000)
  })

  it('m5/m11: conflito do banco (P2034/P2028) numa linha → erro dessa linha, as demais lançadas', async () => {
    for (const code of ['P2034', 'P2028']) {
      banco.tx.transaction.create.mockImplementationOnce(async () => { throw Object.assign(new Error('conflito'), { code }) })
    }
    const { status, j } = await post([linha(), { ...L2, chave: 'K3' }, L2])
    expect(status).toBe(200)
    expect(j.data.resultados.map((r: any) => [r.chave, r.acao, r.erro])).toEqual([
      [CHAVE, 'ERRO', 'conflito com outra operação — repita'], ['K3', 'ERRO', 'conflito com outra operação — repita'], ['K2', 'CRIAR', undefined],
    ])
    expect(banco.saldo('acc1')).toBe(50000 - 990)
  })

  it('m22: lançamento a ligar mudou no meio (conversão count 0) → erro da linha, nada gravado dela, lote segue', async () => {
    banco.transacao({ id: 'n1', account_id: 'acc1', transaction_type: 'CREDIT', amount: 50000, bank_ref: 'AR:a1', transaction_date: dia('2026-11-01') })
    banco.tx.transaction.updateMany.mockImplementationOnce(async () => ({ count: 0 }))
    const { status, j } = await post([linha({ links: ['AR:a1'] }), L2])
    expect(status).toBe(200)
    expect(j.data.resultados[0]).toEqual({ chave: CHAVE, acao: 'ERRO', erro: 'lançamento a ligar mudou durante o lançamento da linha — repita' })
    expect(j.data.resultados[1].acao).toBe('CRIAR')
    expect(banco.tx_('n1')).toEqual(expect.objectContaining({ origin: null, bank_ref: 'AR:a1' }))
  })

  it('m22: órfão levado no meio (conversão count 0) → erro da linha (não cria a linha por cima)', async () => {
    banco.transacao({ id: 'o1', account_id: 'acc1', transaction_type: 'DEBIT', amount: 990, bank_ref: 'AP:x', transaction_date: dia('2026-11-01') })
    banco.tx.transaction.updateMany.mockImplementationOnce(async () => ({ count: 0 }))
    const { j } = await post([L2])
    expect(j.data.resultados[0]).toEqual({ chave: 'K2', acao: 'ERRO', erro: 'órfão mudou durante o lançamento da linha — repita' })
    expect(banco.tabelas.transaction.filter((t) => t.bank_ref === 'K2')).toEqual([])
    expect(banco.saldo('acc1')).toBe(50000)
  })

  it('m5: cada linha numa $transaction com maxWait 10s e timeout 20s', async () => {
    await post([linha(), L2])
    const porLinha = banco.transacoes.slice(-2)
    expect(porLinha.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }, { maxWait: 10000, timeout: 20000 }])
  })
})

