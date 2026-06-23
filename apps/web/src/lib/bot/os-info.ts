// Formato OsInfo (o que o [CONTEXTO DO CLIENTE] do bot consome) + a UNICA
// funcao de mapeamento de uma linha crua de serviceOrder -> OsInfo.
//
// Extraido do chatwoot/bot/route.ts em 2026-06-23. Motivo: o caminho de
// identificacao por TELEFONE (o mais comum) usava as linhas cruas do Prisma
// com `as unknown as OsInfo[]` (otimizacao batch 30/05) — sem mapear. Assim
// equipment/status_name/os_id saiam `undefined`; sem os_id o contexto NAO
// trazia o magic-link e o bot mandava link de portal GENERICO (home) em vez
// do orcamento. Caso OS 61241 (Maria Aparecida). Centralizar aqui garante que
// TODO caminho que produz activeOS use a mesma formatacao.

export interface OsInfo {
  os_number: number
  status_name: string
  equipment: string
  estimated_delivery?: Date | null
  total_cost?: number | null
  os_id?: string
  has_items?: boolean
  technician_name?: string | null
  // contexto de pagamento pra Marta nao mentir sobre cobrancas
  has_pending_charge?: boolean
  payment_online_allowed?: boolean
  // modalidade da OS (EXTERNO = nos coletamos / LOJA = cliente deixou)
  os_location?: string | null
}

// Status onde o cliente pode pagar online via portal (PIX/Boleto). Em outros
// status, pagamento antecipado so com atendente humano.
export const PAYMENT_ONLINE_ALLOWED_STATUSES = new Set<string>([
  'Entregar Reparado',
  'Entregue',
])

// Linha de serviceOrder com as relacoes que getActiveOrders / o batch por
// telefone incluem (module_statuses, service_order_items, user_profiles,
// payments). Tipagem estrutural minima — aceita o payload do Prisma.
export type RawServiceOrder = {
  os_number: number
  id: string
  equipment_type?: string | null
  equipment_brand?: string | null
  equipment_model?: string | null
  estimated_delivery?: Date | null
  total_cost?: number | null
  os_location?: string | null
  module_statuses?: { name?: string | null } | null
  service_order_items?: { id: string }[] | null
  user_profiles?: { name?: string | null } | null
  payments?: { id: string }[] | null
}

/**
 * Mapeia uma linha crua de serviceOrder (com relacoes incluidas) pro formato
 * OsInfo que o contexto do bot consome. USAR em todo lugar que produz activeOS
 * — senao o magic-link, equipamento e status saem vazios.
 */
export function mapOrderToOsInfo(os: RawServiceOrder): OsInfo {
  const statusName = os.module_statuses?.name || 'Desconhecido'
  return {
    os_number: os.os_number,
    status_name: statusName,
    equipment: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
    estimated_delivery: os.estimated_delivery,
    total_cost: os.total_cost,
    os_id: os.id,
    has_items: (os.service_order_items?.length || 0) > 0,
    technician_name: os.user_profiles?.name || null,
    has_pending_charge: (os.payments?.length || 0) > 0,
    payment_online_allowed: PAYMENT_ONLINE_ALLOWED_STATUSES.has(statusName),
    os_location: os.os_location,
  }
}
