import { describe, it, expect } from 'vitest'
import { needsCloudSale, buildCloudSale, isCloudSalesAck } from './cloud-sales'

describe('needsCloudSale', () => {
  it('OS sem envio nenhum precisa', () => {
    expect(needsCloudSale({})).toBe(true)
    expect(needsCloudSale(null)).toBe(true)
    expect(needsCloudSale({ conversion_uploaded: { lead_at: 'x' } })).toBe(true)
  })
  it('já enviada pela API não vai (evita venda em dobro)', () => {
    expect(needsCloudSale({ conversion_uploaded: { approved_at: '2026-10-17T10:00:00Z' } })).toBe(false)
  })
  it('já registrada na nuvem não vai de novo', () => {
    expect(needsCloudSale({ conversion_uploaded: { cloud_sale_at: '2026-10-17T10:00:00Z' } })).toBe(false)
  })
})

describe('buildCloudSale', () => {
  const at = new Date('2026-10-16T18:30:00Z')
  it('monta o registro com valor em reais e conversas sem repetir', () => {
    expect(buildCloudSale({ osNumber: 62743, approvedCostCents: 69500, approvedAt: at, convIds: [22502, 22502, null, 0] }))
      .toEqual({ os_numero: '62743', conversas: [22502], valor: 695, aprovado_em: '2026-10-16T18:30:00.000Z' })
  })
  it('aceita valor como texto/bigint', () => {
    expect(buildCloudSale({ osNumber: '1', approvedCostCents: '12345', approvedAt: at, convIds: [] })?.valor).toBe(123.45)
    expect(buildCloudSale({ osNumber: '1', approvedCostCents: BigInt(500), approvedAt: at, convIds: [] })?.valor).toBe(5)
  })
  it('sem valor, sem número ou sem data: não registra', () => {
    expect(buildCloudSale({ osNumber: 1, approvedCostCents: 0, approvedAt: at, convIds: [] })).toBeNull()
    expect(buildCloudSale({ osNumber: null, approvedCostCents: 100, approvedAt: at, convIds: [] })).toBeNull()
    expect(buildCloudSale({ osNumber: 1, approvedCostCents: 100, approvedAt: null, convIds: [] })).toBeNull()
  })
})

describe('isCloudSalesAck', () => {
  it('só aceita a resposta da rota /vendas', () => {
    expect(isCloudSalesAck({ ok: true, recebidas: 2, gravadas: 2 })).toBe(true)
    expect(isCloudSalesAck({ ok: true, service: 'chatwoot-origem', versao: '3.10' })).toBe(false) // versão antiga: 200 genérico
    expect(isCloudSalesAck({ error: 'unauthorized' })).toBe(false)
    expect(isCloudSalesAck(null)).toBe(false)
  })
})
