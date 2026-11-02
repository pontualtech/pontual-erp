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

describe('banco-falso.aoTravar (fix 3, m14): o que o gancho grava comitou — sobrevive ao rollback da tx aberta', () => {
  it('linha apagada pelo gancho não ressuscita no rollback; a criada e a alterada continuam', async () => {
    const banco = criarBanco()
    banco.conta({ id: 'a' })
    banco.transacao({ id: 'apagar', account_id: 'a', transaction_type: 'CREDIT', amount: 1 })
    banco.transacao({ id: 'mudar', account_id: 'a', transaction_type: 'CREDIT', amount: 1 })
    banco.aoTravar(() => {
      banco.tabelas.transaction.splice(banco.tabelas.transaction.findIndex((t) => t.id === 'apagar'), 1)
      banco.tx_('mudar')!.amount = 2
      banco.transacao({ id: 'nova', account_id: 'a', transaction_type: 'CREDIT', amount: 3 })
      banco.aoTravar(null)
    })
    await expect(banco.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${'a'} AND company_id = ${'c1'} FOR UPDATE`
      throw new Error('desfaz')
    })).rejects.toThrow('desfaz')
    expect(banco.tx_('apagar')).toBeUndefined()
    expect(banco.tx_('mudar')!.amount).toBe(2)
    expect(banco.tx_('nova')).toBeDefined()
  })
})
