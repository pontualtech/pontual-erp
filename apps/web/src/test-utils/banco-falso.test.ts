import { describe, it, expect } from 'vitest'
import { criarBanco } from './banco-falso'

describe('banco-falso.reset (F2-G, m23)', () => {
  it('descarta implementações "once" pendentes e volta à implementação base do modelo', async () => {
    const banco = criarBanco()
    banco.transacao({ id: 't1', account_id: 'a', transaction_type: 'CREDIT', amount: 1 })
    banco.tx.transaction.updateMany.mockImplementationOnce(async () => ({ count: 0 }))
    banco.reset()
    banco.transacao({ id: 't1', account_id: 'a', transaction_type: 'CREDIT', amount: 1 })
    expect(await banco.tx.transaction.updateMany({ where: { id: 't1' }, data: { amount: 2 } })).toEqual({ count: 1 })
    expect(banco.tx_('t1')!.amount).toBe(2)
  })
})
