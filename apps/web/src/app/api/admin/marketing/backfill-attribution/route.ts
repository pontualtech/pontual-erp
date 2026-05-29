import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * Frente A — Atribuição retroativa (2026-05-29).
 *
 * Pré-Sprint 1: OS criadas via /api/os manual (atendente) NÃO populavam
 * custom_data.tracking, mesmo quando customer JÁ TINHA botConversation com
 * attribution preenchida (do CWT/[ref:] ou fingerprint server-side).
 *
 * Sprint 1 corrigiu o futuro (commit 5e0b6f6). Este endpoint corrige o PASSADO:
 * cruza OS sem tracking × botConv com attribution pelo phone do customer (last 9
 * digits) e popula custom_data.tracking retroativamente.
 *
 * USAGE:
 *   POST /api/admin/marketing/backfill-attribution            → dry-run (default)
 *   POST /api/admin/marketing/backfill-attribution?apply=true → aplica de verdade
 *
 * Conservador:
 *   - dry-run por padrão (response mostra o que mudaria sem alterar nada)
 *   - só preenche OS criada DEPOIS da botConv (não inverte causalidade)
 *   - phone match por last 9 digits (consistente com Sprint 1)
 *   - tracking_source = 'backfill_2026_05_29' pra audit posterior
 *   - logAudit por OS modificada
 */

function phoneEnd(p: string | null | undefined): string | null {
  if (!p) return null
  const digits = p.replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : null
}

function deriveTracking(attribution: Record<string, any>): Record<string, string> {
  const tracking: Record<string, string> = {}
  if (attribution.gclid) tracking.gclid = String(attribution.gclid)
  if (attribution.gbraid) tracking.gbraid = String(attribution.gbraid)
  if (attribution.wbraid) tracking.wbraid = String(attribution.wbraid)
  if (attribution.msclkid) tracking.msclkid = String(attribution.msclkid)
  if (attribution.fbclid) tracking.fbclid = String(attribution.fbclid)
  if (attribution.li_fat_id) tracking.li_fat_id = String(attribution.li_fat_id)
  if (attribution.twclid) tracking.twclid = String(attribution.twclid)
  if (attribution.ttclid) tracking.ttclid = String(attribution.ttclid)
  const src = attribution.utm_source || attribution.src
  if (src) tracking.utm_source = String(src)
  const med = attribution.utm_medium || attribution.med
  if (med) tracking.utm_medium = String(med)
  const camp = attribution.utm_campaign || attribution.camp
  if (camp) tracking.utm_campaign = String(camp)
  const kw = attribution.utm_term || attribution.kw
  if (kw) tracking.utm_term = String(kw)
  const cont = attribution.utm_content || attribution.cont
  if (cont) tracking.utm_content = String(cont)
  return tracking
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('marketing', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const apply = req.nextUrl.searchParams.get('apply') === 'true'

    // 1. Pegar todas botConv da company COM attribution gravada
    // (Prisma rejeita { not: null } no where — filtramos null no JS depois)
    const convs = await prisma.botConversation.findMany({
      where: {
        company_id: user.companyId,
      },
      select: {
        id: true,
        customer_phone: true,
        data: true,
        created_at: true,
      },
    })

    // Filtra só com attribution
    const convsWithAttr = convs.filter(c => {
      const d = c.data as any
      return d?.attribution && typeof d.attribution === 'object' && Object.keys(d.attribution).length > 0
    })

    // 2. Index attribution by phoneEnd (last 9 digits). Quando há múltiplas
    //    convs do mesmo phone, mantém a MAIS RECENTE.
    const attrByPhone = new Map<string, { attribution: Record<string, any>; created_at: Date; conv_id: string }>()
    for (const c of convsWithAttr) {
      const pe = phoneEnd(c.customer_phone)
      if (!pe) continue
      const existing = attrByPhone.get(pe)
      if (!existing || c.created_at > existing.created_at) {
        attrByPhone.set(pe, {
          attribution: (c.data as any).attribution,
          created_at: c.created_at,
          conv_id: c.id,
        })
      }
    }

    // 3. Buscar OS da company SEM tracking (customer_id checado no loop abaixo)
    const osList = await prisma.serviceOrder.findMany({
      where: {
        company_id: user.companyId,
        deleted_at: null,
      },
      select: {
        id: true,
        os_number: true,
        custom_data: true,
        created_at: true,
        customers: { select: { phone: true, mobile: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 10000,
    })

    const candidatesNoTracking = osList.filter(o => {
      const cd = (o.custom_data as any) || {}
      const tracking = cd.tracking
      return !tracking || typeof tracking !== 'object' || Object.keys(tracking).length === 0
    })

    // 4. Pra cada candidate, tentar match
    type Match = {
      os_id: string
      os_number: number
      phone_end: string
      conv_id: string
      tracking: Record<string, string>
      new_custom_data: Record<string, any>
    }
    const matches: Match[] = []
    for (const os of candidatesNoTracking) {
      const cust = os.customers
      if (!cust) continue
      const pe = phoneEnd(cust.phone || cust.mobile)
      if (!pe) continue
      const m = attrByPhone.get(pe)
      if (!m) continue
      // Causalidade: só preenche se OS criada DEPOIS (ou no mesmo momento) que a conv
      // (impossível conv responder a OS que ainda não existia)
      if (os.created_at && os.created_at < m.created_at) continue
      const tracking = deriveTracking(m.attribution)
      if (Object.keys(tracking).length === 0) continue
      const existingCd = (os.custom_data as any) || {}
      matches.push({
        os_id: os.id,
        os_number: os.os_number,
        phone_end: pe,
        conv_id: m.conv_id,
        tracking,
        new_custom_data: {
          ...existingCd,
          tracking,
          tracking_captured_at: new Date().toISOString(),
          tracking_source: 'backfill_2026_05_29',
        },
      })
    }

    // 5. Apply ou dry-run
    const breakdown: Record<string, number> = {}
    for (const m of matches) {
      for (const k of Object.keys(m.tracking)) {
        breakdown[k] = (breakdown[k] || 0) + 1
      }
    }

    if (!apply) {
      return success({
        mode: 'dry_run',
        summary: {
          total_os_no_tracking: candidatesNoTracking.length,
          total_convs_with_attribution: convsWithAttr.length,
          distinct_phones_with_attribution: attrByPhone.size,
          would_update_count: matches.length,
        },
        breakdown_by_field: breakdown,
        sample: matches.slice(0, 20).map(m => ({
          os_number: m.os_number,
          phone_end: m.phone_end,
          tracking_keys: Object.keys(m.tracking),
          gclid_short: m.tracking.gclid ? `${m.tracking.gclid.slice(0, 25)}...` : null,
          utm_source: m.tracking.utm_source || null,
        })),
        hint: 'Repita com ?apply=true para aplicar.',
      })
    }

    // Apply de verdade
    let appliedCount = 0
    const errors: { os_id: string; error: string }[] = []
    for (const m of matches) {
      try {
        await prisma.serviceOrder.update({
          where: { id: m.os_id },
          data: { custom_data: m.new_custom_data },
        })
        await logAudit({
          companyId: user.companyId,
          userId: user.id,
          module: 'os',
          action: 'backfill_tracking',
          entityId: m.os_id,
          newValue: { tracking: m.tracking, tracking_source: 'backfill_2026_05_29' },
        }).catch(() => {}) // audit não-bloqueante
        appliedCount++
      } catch (e: any) {
        errors.push({ os_id: m.os_id, error: e?.message || String(e) })
      }
    }

    return success({
      mode: 'applied',
      summary: {
        total_os_no_tracking: candidatesNoTracking.length,
        matched_count: matches.length,
        applied_count: appliedCount,
        error_count: errors.length,
      },
      breakdown_by_field: breakdown,
      errors: errors.slice(0, 10),
    })
  } catch (e) {
    return handleError(e)
  }
}
