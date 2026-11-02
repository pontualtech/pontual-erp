import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))

import { desligarLinhas, SELECT_LINHA_LIGADA } from './livro-baixa-db'
import { banco } from '@/test-utils/banco-falso'

beforeEach(() => {
  banco.reset()
  banco.categoriasPadrao()
})

describe('desligarLinhas (F2-B, #1)', () => {
  it('só desliga a linha ligada pela ref própria (AR:<id>/AP:<id>); a de ref externa fica como está', async () => {
    const refs = ['AR:r1', 'AP:p1', 'pay_x', 'acquirer:rede:1', 'cnab:9', 'AR:r1:anticipation']
    for (const [i, ref] of refs.entries()) {
      banco.transacao({ id: `L${i}`, account_id: 'acc1', transaction_type: i === 1 ? 'DEBIT' : 'CREDIT', amount: 100, origin: 'BANCO', bank_ref: `K${i}`, source_text: `T${i}`, linked_ref: ref, category_id: 'cat:Venda de Servicos' })
    }
    const linhas = await banco.tx.transaction.findMany({ where: { origin: 'BANCO' }, select: SELECT_LINHA_LIGADA })
    await desligarLinhas(banco.tx, 'c1', linhas)
    expect(refs.map((_, i) => banco.tx_(`L${i}`)!.linked_ref)).toEqual([null, null, 'pay_x', 'acquirer:rede:1', 'cnab:9', 'AR:r1:anticipation'])
    expect(banco.tx_('L0')).toEqual(expect.objectContaining({ category_id: 'cat:Receita a identificar', description: 'T0' }))
    expect(banco.tx_('L2')!.category_id).toBe('cat:Venda de Servicos')
  })
})
