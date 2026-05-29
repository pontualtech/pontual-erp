/**
 * Helper Frente D (2026-05-29): lookup de tracking via botConversation pelo phone.
 *
 * Reusa a mesma lógica que /api/bot/abrir-os já fazia desde 22/05 e que /api/os
 * ganhou no Sprint 1 (commit 5e0b6f6). Centraliza pra ser aplicado também nos
 * outros 3 endpoints de criação de OS (portal/webhook/v1).
 *
 * NÃO refatora /api/bot/abrir-os — funciona, é validado, fica intacto.
 */

import { prisma } from '@pontual/db'

export type LookupResult = {
  tracking: Record<string, string>
  tracking_captured_at: string
}

/**
 * Busca botConversation mais recente do customer pelo phone (last 9 digits)
 * e extrai attribution → tracking format. Retorna null se não acha.
 *
 * Falha silenciosa: qualquer erro no DB retorna null (caller cria OS sem tracking).
 */
export async function lookupTrackingFromConv(
  companyId: string,
  customerPhone: string | null | undefined,
): Promise<LookupResult | null> {
  if (!customerPhone) return null
  try {
    const phoneEnd = customerPhone.replace(/\D/g, '').slice(-10)
    if (phoneEnd.length < 10) return null
    const conv = await prisma.botConversation.findFirst({
      where: {
        company_id: companyId,
        customer_phone: { endsWith: phoneEnd },
      },
      orderBy: { created_at: 'desc' },
    })
    const attrRaw = conv?.data && typeof conv.data === 'object' && !Array.isArray(conv.data)
      ? ((conv.data as Record<string, any>).attribution as Record<string, string> | undefined)
      : undefined
    if (!attrRaw) return null

    const tracking: Record<string, string> = {}
    if (attrRaw.gclid) tracking.gclid = attrRaw.gclid
    if (attrRaw.gbraid) tracking.gbraid = attrRaw.gbraid
    if (attrRaw.wbraid) tracking.wbraid = attrRaw.wbraid
    if (attrRaw.msclkid) tracking.msclkid = attrRaw.msclkid
    if (attrRaw.fbclid) tracking.fbclid = attrRaw.fbclid
    const src = attrRaw.utm_source || attrRaw.src
    if (src) tracking.utm_source = src
    const med = attrRaw.utm_medium || attrRaw.med
    if (med) tracking.utm_medium = med
    const camp = attrRaw.utm_campaign || attrRaw.camp
    if (camp) tracking.utm_campaign = camp
    const kw = attrRaw.utm_term || attrRaw.kw
    if (kw) tracking.utm_term = kw
    const cont = attrRaw.utm_content || attrRaw.cont
    if (cont) tracking.utm_content = cont

    if (Object.keys(tracking).length === 0) return null

    return { tracking, tracking_captured_at: new Date().toISOString() }
  } catch (e: any) {
    console.warn(`[lookupTracking] falhou (segue sem): ${e?.message}`)
    return null
  }
}
