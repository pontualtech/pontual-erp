/**
 * Vendas (máquinas aprovadas) → base de rastreio da nuvem (17/10/2026, Karlão: "venda é máquina aprovada…
 * para não receber lixo"). A nuvem só manda a venda ao Google e à Microsoft quando acha o clique EXATO do
 * próprio cliente (etiqueta [ref] que o site põe na mensagem do WhatsApp). Registrar aqui não envia nada.
 *
 * Regra anti-duplicidade: OS já enviada pela API (conversion_uploaded.approved_at) não vai para a nuvem;
 * OS registrada na nuvem (conversion_uploaded.cloud_sale_at) não volta para a API.
 */

export interface CloudSalePayload {
  os_numero: string
  conversas: number[]
  valor: number
  aprovado_em: string
}

/** A OS ainda precisa ser registrada na nuvem? */
export function needsCloudSale(customData: unknown): boolean {
  const cd = (customData && typeof customData === 'object' && !Array.isArray(customData)) ? customData as Record<string, any> : {}
  const up = (cd.conversion_uploaded && typeof cd.conversion_uploaded === 'object') ? cd.conversion_uploaded : {}
  return !up.approved_at && !up.cloud_sale_at
}

/** Monta o registro da venda; null se faltar dado essencial (número, valor > 0, data da aprovação). */
export function buildCloudSale(input: {
  osNumber: number | string | null | undefined
  approvedCostCents: number | string | bigint | null | undefined
  approvedAt: Date | null | undefined
  convIds: Array<number | null | undefined>
}): CloudSalePayload | null {
  const os = input.osNumber == null ? '' : String(input.osNumber).trim()
  const valor = input.approvedCostCents == null ? 0 : Number(input.approvedCostCents) / 100
  const at = input.approvedAt instanceof Date && !isNaN(input.approvedAt.getTime()) ? input.approvedAt : null
  if (!os || !(valor > 0) || !at) return null
  const conversas = [...new Set(input.convIds.filter((n): n is number => Number.isInteger(n) && (n as number) > 0))]
  return { os_numero: os, conversas, valor: Math.round(valor * 100) / 100, aprovado_em: at.toISOString() }
}

/** A resposta é da rota /vendas (v3.11+)? Versões antigas respondem 200 genérico — isso NÃO é gravação. */
export function isCloudSalesAck(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>).ok === true
    && typeof (body as Record<string, unknown>).gravadas === 'number'
}
