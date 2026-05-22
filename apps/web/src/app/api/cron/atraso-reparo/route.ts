// GET /api/cron/atraso-reparo
//
// Cron diario (08:00 BRT) — detecta OSs em atraso (estimated_delivery
// estourou) e dispara notificacoes ao cliente:
// - Dia 0 (estouro): WhatsApp + email "OS voltou pra bancada, regime de
//   urgencia, nova ETA = hoje + 5 dias uteis"
// - Dia 1..14: email diario com template DIFERENTE em cada dia
// - Dia 15+: email semanal ate status virar Entregar Reparado / Pronto / Entregue
//
// Estado guardado em service_orders.custom_data.delay {
//   triggered_at, new_eta, daily_count, weekly_count, last_sent_at, last_sent_kind
// }
//
// Protegido por CRON_SECRET. Idempotente (advisory lock + check last_sent_at).

import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { sendCompanyEmail } from '@/lib/send-email'
import { buildMagicLink } from '@/lib/portal-magic-url'
import { buildAtrasoEmail, addBusinessDays, businessDaysUntil, type AtrasoOverride } from '@/lib/email-templates/atraso-reparo'

// Next 14: route depende de cookies/headers/searchParams — força runtime
export const dynamic = 'force-dynamic'

async function loadCompanyOverrides(companyId: string): Promise<Record<string, AtrasoOverride>> {
  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { startsWith: 'notif.atraso_reparo.' } },
    select: { key: true, value: true },
  })
  const out: Record<string, AtrasoOverride> = {}
  for (const s of settings) {
    // key formato: notif.atraso_reparo.day0.subject | .html | .wa | weekly.subject ...
    const parts = s.key.split('.')
    if (parts.length < 4) continue
    const slot = parts[2]   // day0 | day1 | ... | weekly
    const field = parts[3]  // subject | html | wa
    if (!['subject', 'html', 'wa'].includes(field)) continue
    if (!out[slot]) out[slot] = {}
    ;(out[slot] as any)[field] = s.value
  }
  return out
}

interface DelayState {
  triggered_at: string
  new_eta: string
  daily_count: number
  weekly_count: number
  last_sent_at: string
  last_sent_kind: 'daily' | 'weekly'
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(b.getTime() - a.getTime())
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

export async function GET(request: NextRequest) {
  let lockAcquired = false
  try {
    const _lock: Array<{ ok: boolean }> = await (prisma as any).$queryRaw`
      SELECT pg_try_advisory_lock(hashtext('cron:atraso-reparo')::bigint) AS ok
    `
    if (!_lock?.[0]?.ok) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'concurrent_run' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    lockAcquired = true
  } catch { /* non-fatal */ }

  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) return error('CRON_SECRET nao configurado', 503)
    const authHeader = request.headers.get('authorization') || ''
    const expected = `Bearer ${cronSecret}`
    if (authHeader.length !== expected.length || !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))) {
      return error('Nao autorizado', 401)
    }

    const now = new Date()
    const stats = { scanned: 0, dia0: 0, daily: 0, weekly: 0, skipped: 0, errors: 0 }

    // Multi-tenant: rodar por empresa, similar ao padrao dos outros crons
    const companies = await prisma.company.findMany({ where: { is_active: true }, select: { id: true, slug: true, name: true } })

    for (const company of companies) {
      // Carrega overrides de templates (settings.notif.atraso_reparo.*)
      const overrides = await loadCompanyOverrides(company.id)
      const pickOverride = (idx: number) => {
        if (idx >= 14) return overrides['weekly']
        return overrides[`day${idx}`]
      }

      // Status finais (Entregue/Cancelada/etc) e tambem "Entregar Reparado" e "Pronto"
      // pra parar de notificar quando equipamento ja foi entregue ao cliente.
      const stopStatuses = await prisma.moduleStatus.findMany({
        where: {
          company_id: company.id,
          module: 'os',
          OR: [
            { is_final: true },
            { name: { contains: 'Entregar Reparado', mode: 'insensitive' } },
            { name: { contains: 'Pronto', mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      })
      const stopIds = stopStatuses.map(s => s.id)

      const overdueOSs = await prisma.serviceOrder.findMany({
        where: {
          company_id: company.id,
          deleted_at: null,
          status_id: { notIn: stopIds },
          estimated_delivery: { lt: now },
        },
        include: {
          customers: { select: { id: true, legal_name: true, email: true, mobile: true, phone: true } },
          module_statuses: { select: { name: true } },
        },
      })

      for (const os of overdueOSs) {
        stats.scanned++
        try {
          if (!os.customers?.email) {
            stats.skipped++
            continue
          }

          const customData = (os.custom_data as Record<string, any> | null) || {}
          const delay: DelayState | undefined = customData.delay

          const primeiroNome = (os.customers.legal_name || 'Cliente').split(' ')[0]
          const equipamentoCompleto = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ') || 'Equipamento'

          // Magic link pro portal (auto-login) + encurtado via /lib/short-link
          // (URL crua tem 350+ chars). Mesmo padrao do chat OS e tickets msgs.
          let linkPortal = `https://portal.pontualtech.com.br`
          try {
            const ml = buildMagicLink({
              customerId: os.customers.id,
              companyId: company.id,
              slug: company.slug,
              osId: os.id,
            })
            linkPortal = ml.url
            try {
              const { shortenUrl } = await import('@/lib/short-link')
              linkPortal = await shortenUrl(ml.url, company.id, os.customers.id)
            } catch (e: any) {
              console.warn(`[cron/atraso] shorten falhou OS-${os.os_number}, usando URL completa:`, e?.message)
            }
          } catch { /* fallback ja setado */ }

          const linkSuporte = `https://wa.me/551126263841`

          // PRIMEIRA DETECCAO: dispara WhatsApp + email dia 0
          if (!delay) {
            const newEta = addBusinessDays(now, 5)
            const newDelay: DelayState = {
              triggered_at: now.toISOString(),
              new_eta: newEta.toISOString(),
              daily_count: 0,
              weekly_count: 0,
              last_sent_at: now.toISOString(),
              last_sent_kind: 'daily',
            }
            const vars = {
              primeiro_nome: primeiroNome,
              empresa: company.name,
              os_number: os.os_number,
              equipamento_completo: equipamentoCompleto,
              nova_eta: newEta.toLocaleDateString('pt-BR'),
              dias_uteis_restantes: businessDaysUntil(newEta),
              link_portal: linkPortal,
              link_suporte: linkSuporte,
            }
            const tpl = buildAtrasoEmail(0, vars, pickOverride(0))
            await sendCompanyEmail(company.id, os.customers.email, tpl.subject, tpl.html).catch((e) => {
              console.warn(`[cron/atraso] email dia0 falhou OS-${os.os_number}:`, e?.message)
            })

            // Audit: registra no historico da OS pra operador ver
            await prisma.serviceOrderHistory.create({
              data: {
                company_id: company.id,
                service_order_id: os.id,
                from_status_id: os.status_id,
                to_status_id: os.status_id,
                changed_by: 'SYSTEM',
                notes: `📧 [Atraso D0] Email enviado a ${os.customers.email} — nova ETA ${vars.nova_eta}`,
              },
            }).catch(() => {})

            // 2026-05-21: WhatsApp DESATIVADO no Dia 0. Karlao confirmou que
            // notif de relacionamento (atraso) deve sair do +55 11 2626-3841,
            // mas esse numero ainda nao esta cadastrado como WABA Cloud Meta.
            // Cliente recebe email com link wa.me/551126263841 e pode responder
            // pelo canal certo. Quando WABA 2626-3841 estiver configurado:
            // re-ativar este bloco apontando pra phone_number_id correto.

            await prisma.serviceOrder.update({
              where: { id: os.id },
              data: { custom_data: { ...customData, delay: { ...newDelay, daily_count: 1 } } },
            })
            stats.dia0++
            continue
          }

          // JA NOTIFICADO: decidir se manda daily, weekly ou skip
          const lastSent = new Date(delay.last_sent_at)
          if (isSameDay(lastSent, now)) {
            stats.skipped++ // ja mandou hoje
            continue
          }

          const newEta = new Date(delay.new_eta)
          const vars = {
            primeiro_nome: primeiroNome,
            empresa: company.name,
            os_number: os.os_number,
            equipamento_completo: equipamentoCompleto,
            nova_eta: newEta.toLocaleDateString('pt-BR'),
            dias_uteis_restantes: businessDaysUntil(newEta),
            link_portal: linkPortal,
            link_suporte: linkSuporte,
          }

          // Daily ate 14, depois semanal
          if (delay.daily_count < 14) {
            const tpl = buildAtrasoEmail(delay.daily_count, vars, pickOverride(delay.daily_count))
            await sendCompanyEmail(company.id, os.customers.email, tpl.subject, tpl.html).catch((e) => {
              console.warn(`[cron/atraso] email daily${delay.daily_count} falhou OS-${os.os_number}:`, e?.message)
            })
            await prisma.serviceOrderHistory.create({
              data: {
                company_id: company.id,
                service_order_id: os.id,
                from_status_id: os.status_id,
                to_status_id: os.status_id,
                changed_by: 'SYSTEM',
                notes: `📧 [Atraso D${delay.daily_count}] Email enviado a ${os.customers.email}`,
              },
            }).catch(() => {})
            await prisma.serviceOrder.update({
              where: { id: os.id },
              data: {
                custom_data: {
                  ...customData,
                  delay: { ...delay, daily_count: delay.daily_count + 1, last_sent_at: now.toISOString(), last_sent_kind: 'daily' },
                },
              },
            })
            stats.daily++
          } else {
            // Semanal: so envia se passaram 7+ dias desde ultimo
            if (daysBetween(lastSent, now) < 7) {
              stats.skipped++
              continue
            }
            const tpl = buildAtrasoEmail(99, vars, pickOverride(99)) // >=15 forca weekly
            await sendCompanyEmail(company.id, os.customers.email, tpl.subject, tpl.html).catch((e) => {
              console.warn(`[cron/atraso] email weekly falhou OS-${os.os_number}:`, e?.message)
            })
            await prisma.serviceOrderHistory.create({
              data: {
                company_id: company.id,
                service_order_id: os.id,
                from_status_id: os.status_id,
                to_status_id: os.status_id,
                changed_by: 'SYSTEM',
                notes: `📧 [Atraso Semanal #${delay.weekly_count + 1}] Email enviado a ${os.customers.email}`,
              },
            }).catch(() => {})
            await prisma.serviceOrder.update({
              where: { id: os.id },
              data: {
                custom_data: {
                  ...customData,
                  delay: { ...delay, weekly_count: delay.weekly_count + 1, last_sent_at: now.toISOString(), last_sent_kind: 'weekly' },
                },
              },
            })
            stats.weekly++
          }
        } catch (e: any) {
          stats.errors++
          console.error(`[cron/atraso] OS-${os.os_number} error:`, e?.message)
        }
      }
    }

    return success({ ok: true, stats, ranAt: now.toISOString() })
  } catch (err) {
    return handleError(err)
  } finally {
    if (lockAcquired) {
      try { await (prisma as any).$queryRaw`SELECT pg_advisory_unlock(hashtext('cron:atraso-reparo')::bigint)` } catch { /* ignore */ }
    }
  }
}
