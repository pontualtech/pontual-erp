import { describe, it, expect } from 'vitest'
import { cloudSaleAction, firstDeliveredAt, buildCloudSale, isCloudSalesAck } from './cloud-sales'

// 21/10/2026 (Karlão): venda real = OS "Entregue" (reparada e retirada). Aprovada que não foi buscada,
// recusada depois ou doada NÃO é venda.
describe('cloudSaleAction', () => {
  const entregue = new Date('2026-10-20T15:00:00Z')
  it('entregue e ainda não registrada como entregue: registra', () => {
    expect(cloudSaleAction({}, entregue)).toBe('register')
    expect(cloudSaleAction(null, entregue)).toBe('register')
    expect(cloudSaleAction({ conversion_uploaded: { cloud_sale_at: 'x', cloud_hold_at: 'y' } }, entregue)).toBe('register')
  })
  it('aprovada mas não entregue: não registra', () => {
    expect(cloudSaleAction({}, null)).toBe('none')
    expect(cloudSaleAction({ conversion_uploaded: { lead_at: 'x' } }, undefined)).toBe('none')
  })
  it('registrada na aprovação (regra antiga) e não entregue: segura (tira as conversas na nuvem)', () => {
    expect(cloudSaleAction({ conversion_uploaded: { cloud_sale_at: '2026-10-17T10:00:00Z' } }, null)).toBe('hold')
  })
  it('já segurada ou já registrada como entregue: nada a fazer', () => {
    expect(cloudSaleAction({ conversion_uploaded: { cloud_sale_at: 'x', cloud_hold_at: 'y' } }, null)).toBe('none')
    expect(cloudSaleAction({ conversion_uploaded: { cloud_delivered_at: 'x' } }, entregue)).toBe('none')
  })
  it('já enviada pela API não vai (evita venda em dobro)', () => {
    expect(cloudSaleAction({ conversion_uploaded: { approved_at: '2026-10-17T10:00:00Z' } }, entregue)).toBe('none')
  })
  it('data de entrega inválida conta como não entregue', () => {
    expect(cloudSaleAction({}, new Date('x'))).toBe('none')
  })
})

describe('firstDeliveredAt', () => {
  const ENT = new Set(['st-entregue'])
  const aprov = new Date('2026-10-01T12:00:00Z')
  const h = (id: string, iso: string) => ({ to_status_id: id, created_at: new Date(iso) })
  it('primeira passagem para Entregue depois da aprovação', () => {
    expect(firstDeliveredAt([
      h('st-aprovado', '2026-10-01T12:00:00Z'),
      h('st-entregue', '2026-10-15T10:00:00Z'),
      h('st-entregue', '2026-10-16T10:00:00Z'),
    ], aprov, ENT)).toEqual(new Date('2026-10-15T10:00:00Z'))
  })
  it('Entregue de antes da aprovação (OS anterior reaberta) não conta', () => {
    expect(firstDeliveredAt([h('st-entregue', '2026-09-01T10:00:00Z')], aprov, ENT)).toBeNull()
  })
  it('sem Entregue (ex.: Entregue Recusado, outro id) ou sem aprovação: null', () => {
    expect(firstDeliveredAt([h('st-entregue-recusado', '2026-10-15T10:00:00Z')], aprov, ENT)).toBeNull()
    expect(firstDeliveredAt([h('st-entregue', '2026-10-15T10:00:00Z')], undefined, ENT)).toBeNull()
    expect(firstDeliveredAt([], aprov, ENT)).toBeNull()
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
