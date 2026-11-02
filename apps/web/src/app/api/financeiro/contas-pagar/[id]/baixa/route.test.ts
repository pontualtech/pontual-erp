import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
vi.mock('@/lib/auth', () => ({ requirePermission: async () => ({ id: 'u1', companyId: 'c1' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

import { POST } from './route'
import { banco } from '@/test-utils/banco-falso'

const ACC = '11111111-1111-4111-8111-111111111111'
const AP = { id: 'p1', status: 'PENDENTE', total_amount: 5000, paid_amount: 0, description: 'Luz', category_id: 'cat:Energia', payment_method: null }
const pagar = async (body: Record<string, unknown>) => {
  const res = await POST(new NextRequest('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: ACC, ...body }) }), { params: { id: 'p1' } })
  return { status: res.status, j: await res.json() }
}
// Linha do livro (BANCO) de saída, livre, em "A classificar", de 28/10.
const linha = (over: Record<string, unknown> = {}) => banco.transacao({
  id: 't1', account_id: ACC, transaction_type: 'DEBIT', amount: 5000, origin: 'BANCO', bank_ref: 'ITAU:k1', source_text: 'PGTO ENEL',
  description: 'PGTO ENEL', category_id: 'cat:A classificar', transaction_date: new Date('2026-10-28T00:00:00Z'), ...over,
})
const ap = () => banco.tabelas.accountPayable.find((a) => a.id === 'p1')!
const debitosAP = () => banco.tabelas.transaction.filter((t) => t.bank_ref === 'AP:p1')

beforeEach(() => {
  banco.reset()
  banco.categoriasPadrao()
  banco.categoria('Ajuste de caixa', 'financeiro_despesa')
  banco.categoria('Anúncios', 'financeiro_despesa')
  banco.conta({ id: ACC, current_balance: 100000 })
})

describe('baixa de AP — livro-razão', () => {
  it('liga ao lançamento do banco: sem DEBIT e sem saldo; a linha recebe a categoria da AP', async () => {
    banco.ap(AP)
    linha()
    const { j } = await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })
    expect(j.data.ligada).toBe(true)
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: 'AP:p1', category_id: 'cat:Energia', description: 'Pgto: Luz · banco: PGTO ENEL' }))
    expect(debitosAP()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(ap()).toEqual(expect.objectContaining({ status: 'PAGO', paid_amount: 5000 }))
  })

  it('linha já categorizada por regra (Energia): liga e mantém a categoria da linha', async () => {
    banco.ap({ ...AP, category_id: 'cat:Energia' })
    linha({ category_id: 'cat:Energia', source_text: 'ELETROPAULO' })
    expect((await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })).j.data.ligada).toBe(true)
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: 'AP:p1', category_id: 'cat:Energia', description: 'Pgto: Luz · banco: ELETROPAULO' }))
  })

  it('linha de ajuste de caixa não serve: cria e debita', async () => {
    banco.ap(AP)
    linha({ category_id: 'cat:Ajuste de caixa' })
    expect((await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })).j.data.ligada).toBe(false)
    expect(debitosAP()).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(95000)
  })

  it('linha ligada por outra baixa no meio (guard count 0): 409 e a AP NÃO fica paga (rollback)', async () => {
    banco.ap(AP)
    linha()
    banco.tx.transaction.updateMany.mockImplementationOnce(async () => ({ count: 0 }))
    expect((await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })).status).toBe(409)
    expect(ap()).toEqual(expect.objectContaining({ status: 'PENDENTE', paid_amount: 0 }))
    expect(debitosAP()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('E3: janela do Pagar = 10 dias antes / 3 depois; linha de 20 dias antes não é ligada (cria)', async () => {
    banco.ap(AP)
    linha({ transaction_date: new Date('2026-10-09T00:00:00Z') })
    expect((await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })).j.data.ligada).toBe(false)
    expect(debitosAP()).toEqual([expect.objectContaining({ amount: 5000 })])
  })

  it('E5: AP sem account_id ganha a conta da baixa; AP com conta mantém a sua', async () => {
    banco.ap({ ...AP, total_amount: 10000 })
    await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })
    expect(ap().account_id).toBe(ACC)
    ap().account_id = 'outra'
    await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })
    expect(ap().account_id).toBe('outra')
  })

  it('sem candidato: cria e debita como hoje', async () => {
    banco.ap(AP)
    expect((await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })).j.data.ligada).toBe(false)
    expect(debitosAP()).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(95000)
  })

  it('livro_transaction_id inválido (linha de categoria alheia): 422 e nada escrito', async () => {
    banco.ap(AP)
    linha({ category_id: 'cat:Anúncios' })
    expect((await pagar({ paid_amount: 5000, livro_transaction_id: 't1' })).status).toBe(422)
    expect(ap().status).toBe('PENDENTE')
    expect(banco.tx_('t1')!.linked_ref).toBeNull()
  })

  it('F5: livro_transaction_id em linha da mesma categoria da AP (Energia): liga, sem criar nem debitar', async () => {
    banco.ap(AP)
    linha({ category_id: 'cat:Energia', source_text: 'ELETROPAULO' })
    const { status, j } = await pagar({ paid_amount: 5000, livro_transaction_id: 't1' })
    expect(status).toBe(200)
    expect(j.data.ligada).toBe(true)
    expect(banco.tx_('t1')!.category_id).toBe('cat:Energia')
    expect(debitosAP()).toEqual([])
  })

  describe('F6/E8: vínculo explícito com diferença ≤ R$ 1 quita a AP por inteiro', () => {
    const AP10 = { ...AP, total_amount: 10000, notes: null }

    it('AP 10000, linha 9950 → PAGO (paid 10000), ligada, nota com 0,50', async () => {
      banco.ap(AP10)
      linha({ amount: 9950 })
      const { status, j } = await pagar({ paid_amount: 9950, livro_transaction_id: 't1' })
      expect(status).toBe(200)
      expect(j.data.ligada).toBe(true)
      expect(ap()).toEqual(expect.objectContaining({ paid_amount: 10000, status: 'PAGO', notes: 'diferença bancária de R$ 0,50' }))
      expect(debitosAP()).toEqual([])
    })

    it('linha 10050 (excede o restante em 0,50) → PAGO; nota anexada às notes existentes', async () => {
      banco.ap({ ...AP10, notes: 'boleto ENEL' })
      linha({ amount: 10050 })
      expect((await pagar({ paid_amount: 10050, livro_transaction_id: 't1' })).j.data.ligada).toBe(true)
      expect(ap()).toEqual(expect.objectContaining({ paid_amount: 10000, status: 'PAGO', notes: 'boleto ENEL — diferença bancária de R$ 0,50' }))
    })

    it('linha igual ao restante: PAGO sem nota; parcial (3000 de 10000) com linha 6990 → PAGO com nota 0,10', async () => {
      banco.ap(AP10)
      linha({ amount: 10000 })
      await pagar({ paid_amount: 10000, livro_transaction_id: 't1' })
      expect(ap()).toEqual(expect.objectContaining({ paid_amount: 10000, status: 'PAGO', notes: null }))
      // Outro cenário na mesma AP: parcial de 3000 já paga (a linha de 10000 do caso acima não é desta parcial).
      Object.assign(ap(), { status: 'PENDENTE', paid_amount: 3000, notes: null })
      banco.tx_('t1')!.linked_ref = null
      linha({ id: 't2', bank_ref: 'ITAU:k2', amount: 6990 })
      await pagar({ paid_amount: 6990, livro_transaction_id: 't2' })
      expect(ap()).toEqual(expect.objectContaining({ paid_amount: 10000, status: 'PAGO', notes: 'diferença bancária de R$ 0,10' }))
    })

    it('sem vínculo explícito, 10050 excede o restante: 400; com vínculo, acima do restante + R$ 1: 400; nada gravado', async () => {
      banco.ap(AP10)
      linha({ amount: 10050 })
      expect((await pagar({ paid_amount: 10050 })).status).toBe(400)
      banco.tx_('t1')!.amount = 10101
      expect((await pagar({ paid_amount: 10101, livro_transaction_id: 't1' })).status).toBe(400)
      banco.tx_('t1')!.amount = 10150
      const r = await pagar({ paid_amount: 10080, livro_transaction_id: 't1' })
      expect(r.status).toBe(400)
      expect(r.j.error).toMatch(/excede o saldo restante/)
      expect(ap().status).toBe('PENDENTE')
      expect(debitosAP()).toEqual([])
    })

    it('E8: valor informado longe da linha (5000 × 9950): 422; R$ 1,01 de diferença: 422; R$ 1,00: aceita', async () => {
      banco.ap(AP10)
      linha({ amount: 9950 })
      const r = await pagar({ paid_amount: 5000, livro_transaction_id: 't1' })
      expect(r.status).toBe(422)
      expect(r.j.error).toBe('valor informado difere da linha do banco')
      expect((await pagar({ paid_amount: 9849, livro_transaction_id: 't1' })).status).toBe(422)
      expect(ap().status).toBe('PENDENTE')
      expect((await pagar({ paid_amount: 9850, livro_transaction_id: 't1' })).status).toBe(200)
      expect(ap()).toEqual(expect.objectContaining({ paid_amount: 10000, status: 'PAGO' }))
    })

    it('linha explícita de pagamento parcial (5000 de 10000): PENDENTE, paid 5000, sem nota', async () => {
      banco.ap(AP10)
      linha({ amount: 5000 })
      await pagar({ paid_amount: 5000, livro_transaction_id: 't1' })
      expect(ap()).toEqual(expect.objectContaining({ paid_amount: 5000, status: 'PENDENTE', notes: null }))
    })
  })
})

describe('§6 AP sem categoria (resolve #14)', () => {
  it('liga à linha já categorizada por regra (ELETROPAULO → Energia) em vez de criar outro DEBIT; a AP recebe a categoria da linha', async () => {
    banco.ap({ ...AP, total_amount: 48000, category_id: null, description: 'Conta de luz' })
    linha({ amount: 48000, category_id: 'cat:Energia', source_text: 'ELETROPAULO', transaction_date: new Date('2026-11-01T00:00:00Z') })
    const { j } = await pagar({ paid_amount: 48000, paid_at: '2026-11-02' })
    expect(j.data.ligada).toBe(true)
    expect(debitosAP()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
    expect(banco.tx_('t1')).toEqual(expect.objectContaining({ linked_ref: 'AP:p1', category_id: 'cat:Energia' }))
    expect(ap()).toEqual(expect.objectContaining({ status: 'PAGO', category_id: 'cat:Energia' }))
  })

  it('linha em fallback continua preferida; ligada a ela, a AP sem categoria segue sem categoria', async () => {
    banco.ap({ ...AP, category_id: null })
    linha({ id: 'cat', bank_ref: 'ITAU:k0', category_id: 'cat:Energia', transaction_date: new Date('2026-10-29T00:00:00Z') })
    linha()
    await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })
    expect(banco.tx_('t1')!.linked_ref).toBe('AP:p1')
    expect(banco.tx_('cat')!.linked_ref).toBeNull()
    expect(ap().category_id).toBeNull()
  })

  it('vínculo explícito a linha categorizada também é aceito para AP sem categoria', async () => {
    banco.ap({ ...AP, category_id: null })
    linha({ category_id: 'cat:Energia' })
    const { status } = await pagar({ paid_amount: 5000, livro_transaction_id: 't1' })
    expect(status).toBe(200)
    expect(ap().category_id).toBe('cat:Energia')
  })

  it('linha de transferência entre contas nunca serve, nem para AP sem categoria', async () => {
    banco.ap({ ...AP, category_id: null, total_amount: 10000 })
    linha({ category_id: 'cat:Transferência entre contas' })
    expect((await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })).j.data.ligada).toBe(false)
    expect((await pagar({ paid_amount: 5000, livro_transaction_id: 't1' })).status).toBe(422)
  })
})

describe('§7: trava conta → AP e decide pela releitura', () => {
  it('trava accounts ANTES da AP; candidatos e escritas pelo tx, depois das travas', async () => {
    banco.ap(AP)
    linha()
    await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })
    expect(banco.travas.map((t) => [t.tabela, t.id])).toEqual([['accounts', ACC], ['accounts_payable', 'p1']])
    const candidatos = banco.log.find((o) => o.modelo === 'transaction' && o.op === 'findMany')!
    expect(candidatos.cliente).toBe('tx')
    expect(candidatos.seq).toBeGreaterThan(banco.travas[1].seq)
    expect(banco.prismaDentroDaTx()).toEqual([])
  })

  it('G1: duplo clique — a 1ª baixa parcial comitou enquanto esta esperava: 409, nada criado nem debitado', async () => {
    banco.ap({ ...AP, total_amount: 10000 })
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts_payable') return
      Object.assign(ap(), { paid_amount: 2000 })
      banco.aoTravar(null)
    })
    const { status, j } = await pagar({ paid_amount: 2000, paid_at: '2026-10-29' })
    expect(status).toBe(409)
    expect(j.error).toMatch(/Baixa concorrente detectada/)
    expect(debitosAP()).toEqual([])
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('E7: conta paga / cancelada / excluída enquanto esperava a trava: 409, nada gravado', async () => {
    banco.ap(AP)
    for (const muda of [{ status: 'PAGO', paid_amount: 5000 }, { status: 'CANCELADO' }, { deleted_at: new Date() }]) {
      Object.assign(ap(), { status: 'PENDENTE', paid_amount: 0, deleted_at: null })
      banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_payable') Object.assign(ap(), muda) })
      expect((await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })).status).toBe(409)
    }
    expect(debitosAP()).toEqual([])
  })
})

describe('§8: mensagens e datas', () => {
  it('conta excluída durante a baixa → 409 "conta não encontrada durante a baixa"; paga por outra → mensagem para o operador', async () => {
    banco.ap(AP)
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_payable') ap().deleted_at = new Date() })
    expect((await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })).j.error).toBe('conta não encontrada durante a baixa')
    ap().deleted_at = null
    banco.aoTravar(({ tabela }) => { if (tabela === 'accounts_payable') Object.assign(ap(), { status: 'PAGO', paid_amount: 5000 }) })
    expect((await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })).j.error).toBe('esta conta acabou de ser paga por outra pessoa — recarregue')
  })

  it('m9: paid_at que não é data → 422 (antes: 500), nada gravado', async () => {
    banco.ap(AP)
    expect((await pagar({ paid_amount: 5000, paid_at: '31/10/2026' })).status).toBe(422)
    expect(ap().status).toBe('PENDENTE')
    expect(debitosAP()).toEqual([])
  })
})

describe('F2-A (#3): Pagar enxerga a saída já lançada da AP', () => {
  it('DEBIT AP:id vivo (marcador antigo LIGADA que o estorno (d) não compensou): Pagar não cria nada e avisa', async () => {
    banco.ap({ ...AP, paid_amount: 0 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1', source_text: 'LIGADA:ITAU:k' })
    const { status, j } = await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })
    expect(status).toBe(200)
    expect(j.data).toEqual(expect.objectContaining({ status: 'PAGO', paid_amount: 5000, ligada: false, aviso: 'dinheiro desta conta já está lançado (adquirente/CNAB/Asaas/banco) — nenhum lançamento novo criado' }))
    expect(debitosAP()).toHaveLength(1)
    expect(banco.tx.account.update).not.toHaveBeenCalled()
  })

  it('linha do banco ligada a AP:id e AP com pagamento 0: idem; pagamento parcial já registrado não bloqueia a 2ª parcela', async () => {
    banco.ap({ ...AP, paid_amount: 0, total_amount: 10000 })
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, origin: 'BANCO', bank_ref: 'ITAU:k0', linked_ref: 'AP:p1' })
    expect((await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })).j.data.aviso).toBeTruthy()
    expect(debitosAP()).toEqual([])
    const { j } = await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })
    expect(j.data).not.toHaveProperty('aviso')
    expect(debitosAP()).toEqual([expect.objectContaining({ amount: 5000 })])
  })
})

describe('F2-G (m21): opções da $transaction', () => {
  it('maxWait 10s e timeout 20s', async () => {
    banco.ap(AP)
    await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })
    expect(banco.transacoes.map((t) => t.opcoes)).toEqual([{ maxWait: 10000, timeout: 20000 }])
  })
})

describe('Fix 3 — testes menores do Pagar (m6, m7, m8)', () => {
  const AVISO = 'dinheiro desta conta já está lançado (adquirente/CNAB/Asaas/banco) — nenhum lançamento novo criado'
  it('m6: DEBIT AP:id comitado enquanto o Pagar esperava a trava → só a claim + aviso; nada debitado', async () => {
    banco.ap(AP)
    banco.aoTravar(({ tabela }) => {
      if (tabela !== 'accounts') return
      banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1', source_text: 'LIGADA:ITAU:k' })
      banco.aoTravar(null)
    })
    const { status, j } = await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })
    expect(status).toBe(200)
    expect(j.data).toEqual(expect.objectContaining({ ligada: false, aviso: AVISO }))
    expect(debitosAP()).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(100000)
  })

  it('m7: AP sem conta, saída já lançada noutra conta (inter) → a AP herda a conta do lançamento, não a do pedido', async () => {
    banco.conta({ id: 'inter', current_balance: 50000 })
    banco.ap({ ...AP, account_id: null })
    banco.transacao({ account_id: 'inter', transaction_type: 'DEBIT', amount: 5000, origin: 'BANCO', bank_ref: 'INTER:k0', linked_ref: 'AP:p1' })
    const { j } = await pagar({ paid_amount: 5000, paid_at: '2026-10-29' })
    expect(j.data.aviso).toBe(AVISO)
    expect(ap().account_id).toBe('inter')
  })

  it('m8 (desvio aceito): com a saída já lançada, Pagar ignora livro_transaction_id — não liga a linha pedida', async () => {
    banco.ap(AP)
    banco.transacao({ account_id: ACC, transaction_type: 'DEBIT', amount: 5000, bank_ref: 'AP:p1', source_text: 'LIGADA:ITAU:k' })
    linha()
    const { status, j } = await pagar({ paid_amount: 5000, paid_at: '2026-10-29', livro_transaction_id: 't1' })
    expect(status).toBe(200)
    expect(j.data).toEqual(expect.objectContaining({ status: 'PAGO', ligada: false, aviso: AVISO }))
    expect(banco.tx_('t1')!.linked_ref).toBeNull()
    expect(debitosAP()).toHaveLength(1)
    expect(banco.saldo(ACC)).toBe(100000)
  })
})
