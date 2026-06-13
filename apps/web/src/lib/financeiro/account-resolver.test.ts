import { describe, it, expect } from 'vitest'
import { normalizePaymentMethod, resolveDestinationAccount } from './account-resolver'

describe('normalizePaymentMethod — normaliza rótulos divergentes do banco', () => {
  it('variações de cartão de crédito', () => {
    expect(normalizePaymentMethod('CREDIT_CARD')).toBe('CREDIT_CARD')
    expect(normalizePaymentMethod('Cartão Crédito')).toBe('CREDIT_CARD')
    expect(normalizePaymentMethod('CARTAO_CREDITO')).toBe('CREDIT_CARD')
  })
  it('débito', () => {
    expect(normalizePaymentMethod('DEBIT_CARD')).toBe('DEBIT_CARD')
    expect(normalizePaymentMethod('Cartão Débito')).toBe('DEBIT_CARD')
  })
  it('pix / boleto / dinheiro', () => {
    expect(normalizePaymentMethod('PIX')).toBe('PIX')
    expect(normalizePaymentMethod('pix')).toBe('PIX')
    expect(normalizePaymentMethod('BOLETO')).toBe('BOLETO')
    expect(normalizePaymentMethod('Boleto')).toBe('BOLETO')
    expect(normalizePaymentMethod('CASH')).toBe('CASH')
    expect(normalizePaymentMethod('Dinheiro')).toBe('CASH')
  })
  it('vazio / desconhecido → OTHER', () => {
    expect(normalizePaymentMethod('')).toBe('OTHER')
    expect(normalizePaymentMethod(null)).toBe('OTHER')
    expect(normalizePaymentMethod('xpto')).toBe('OTHER')
  })
})

describe('resolveDestinationAccount — mapa método→conta (mapa do Karlão 13/06)', () => {
  const SETTINGS: Record<string, string> = {
    'finance.account.pix': 'ITAU',
    'finance.account.pix_portal': 'ASSAS',
    'finance.account.boleto': 'ASSAS',
    'finance.account.cash': 'ITAU',
    'finance.account.default': 'ITAU',
    'acquirer.rede.account_id': 'ITAU',
  }
  const fakePrisma = (map: Record<string, string>) => ({
    setting: {
      findFirst: async ({ where }: any) => (map[where.key] ? { value: map[where.key] } : null),
    },
  })

  it('cartão maquininha (crédito/débito) → conta da adquirente (Itaú)', async () => {
    expect(await resolveDestinationAccount(fakePrisma(SETTINGS) as any, 'c', 'CREDIT_CARD')).toBe('ITAU')
    expect(await resolveDestinationAccount(fakePrisma(SETTINGS) as any, 'c', 'Cartão Crédito')).toBe('ITAU')
    expect(await resolveDestinationAccount(fakePrisma(SETTINGS) as any, 'c', 'DEBIT_CARD')).toBe('ITAU')
  })
  it('boleto → ASSAS', async () => {
    expect(await resolveDestinationAccount(fakePrisma(SETTINGS) as any, 'c', 'BOLETO')).toBe('ASSAS')
  })
  it('PIX normal → Itaú; PIX via portal → ASSAS (nuance do Karlão)', async () => {
    expect(await resolveDestinationAccount(fakePrisma(SETTINGS) as any, 'c', 'PIX')).toBe('ITAU')
    expect(await resolveDestinationAccount(fakePrisma(SETTINGS) as any, 'c', 'PIX', 'portal')).toBe('ASSAS')
    expect(await resolveDestinationAccount(fakePrisma(SETTINGS) as any, 'c', 'PIX', 'asaas')).toBe('ASSAS')
  })
  it('dinheiro → Itaú', async () => {
    expect(await resolveDestinationAccount(fakePrisma(SETTINGS) as any, 'c', 'CASH')).toBe('ITAU')
  })
  it('método desconhecido → default', async () => {
    expect(await resolveDestinationAccount(fakePrisma(SETTINGS) as any, 'c', 'xpto')).toBe('ITAU')
  })
  it('sem mapeamento e sem default → null (não inventa conta)', async () => {
    expect(await resolveDestinationAccount(fakePrisma({}) as any, 'c', 'PIX')).toBeNull()
  })
})
