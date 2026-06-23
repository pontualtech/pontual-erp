import { describe, it, expect } from 'vitest'
import { mapOrderToOsInfo } from './os-info'

// Regressao do bug do magic-link (caso OS 61241 Maria Aparecida, 23/06):
// o caminho de identificacao por telefone usava linhas CRUAS de serviceOrder
// `as unknown as OsInfo[]` -> equipment/status_name/os_id ficavam undefined,
// sem os_id NAO gera magic-link -> bot mandava link de portal generico.
// mapOrderToOsInfo e a fonte unica de formatacao usada em TODO caminho.

const rawRow = {
  os_number: 61241,
  id: 'abc-123-uuid',
  equipment_type: 'Impressora',
  equipment_brand: 'HP',
  equipment_model: 'LaserJet M428',
  estimated_delivery: null,
  total_cost: 25000,
  os_location: 'EXTERNO',
  module_statuses: { name: 'Aguardando Aprovacao' },
  service_order_items: [{ id: 'i1' }],
  user_profiles: { name: 'Tecnico Joao' },
  payments: [{ id: 'p1' }],
}

describe('mapOrderToOsInfo — formata serviceOrder cru pro contexto do bot', () => {
  it('preenche os_id (necessario pro magic-link do portal)', () => {
    expect(mapOrderToOsInfo(rawRow).os_id).toBe('abc-123-uuid')
  })

  it('junta equipamento e nao deixa undefined', () => {
    expect(mapOrderToOsInfo(rawRow).equipment).toBe('Impressora HP LaserJet M428')
  })

  it('preenche status_name a partir de module_statuses', () => {
    expect(mapOrderToOsInfo(rawRow).status_name).toBe('Aguardando Aprovacao')
  })

  it('mantem os_location e has_pending_charge', () => {
    const r = mapOrderToOsInfo(rawRow)
    expect(r.os_location).toBe('EXTERNO')
    expect(r.has_pending_charge).toBe(true)
  })

  it('payment_online_allowed = false em status que nao libera (Aguardando Aprovacao)', () => {
    expect(mapOrderToOsInfo(rawRow).payment_online_allowed).toBe(false)
  })

  it('payment_online_allowed = true em "Entregue"', () => {
    expect(mapOrderToOsInfo({ ...rawRow, module_statuses: { name: 'Entregue' } }).payment_online_allowed).toBe(true)
  })

  it('status ausente vira "Desconhecido" sem quebrar', () => {
    expect(mapOrderToOsInfo({ ...rawRow, module_statuses: null }).status_name).toBe('Desconhecido')
  })
})
