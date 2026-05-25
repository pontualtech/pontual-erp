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
import { addBusinessDays, businessDaysUntil, PECAS_EM_TRANSITO } from '@/lib/email-templates/atraso-reparo'

/**
 * Wave AG-3 (2026-05-24): substitui placeholders {{var}} num HTML template.
 * Usado quando Karlao customiza o template via /config/atraso-reparo (HTML salvo
 * em setting atraso_reparo.email_template).
 */
function interpolateAtrasoHtml(html: string, vars: {
  primeiro_nome: string; empresa: string; os_number: string | number;
  equipamento_completo: string; nova_eta: string; dias_uteis_restantes: number;
  link_portal: string; link_suporte: string;
}): string {
  return html
    .replace(/\{\{primeiro_nome\}\}/g, String(vars.primeiro_nome))
    .replace(/\{\{empresa\}\}/g, String(vars.empresa))
    .replace(/\{\{os_number\}\}/g, String(vars.os_number))
    .replace(/\{\{equipamento_completo\}\}/g, String(vars.equipamento_completo))
    .replace(/\{\{nova_eta\}\}/g, String(vars.nova_eta))
    .replace(/\{\{dias_uteis_restantes\}\}/g, String(vars.dias_uteis_restantes))
    .replace(/\{\{link_portal\}\}/g, String(vars.link_portal))
    .replace(/\{\{link_suporte\}\}/g, String(vars.link_suporte))
}

// Next 14: route depende de cookies/headers/searchParams — força runtime
export const dynamic = 'force-dynamic'

interface DelayState {
  triggered_at: string
  new_eta: string
  daily_count: number
  weekly_count: number
  last_sent_at: string
  last_sent_kind: 'daily' | 'weekly'
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

    // Karlao 2026-05-24: cron limitado SO a PontualTech. Imprimitech/outras
    // empresas tem fluxo proprio (Aline/Vitoria) e templates diferentes —
    // evita spam acidental. Pra estender pra outra empresa, adicionar slug aqui.
    const companies = await prisma.company.findMany({
      where: { is_active: true, slug: 'pontualtech' },
      select: { id: true, slug: true, name: true },
    })

    for (const company of companies) {
      // Karlao 2026-05-24: filtro estrito por status "Aprovado".
      // Antes filtrava TUDO exceto status final/"Pronto"/"Entregar Reparado" —
      // mandava email pra OS em "Coletar", "Orcar", "Aguardando Aprovacao", etc.
      // Match: normalize sem acento + lowercase + regex `^aprovad[oa]$` (Aprovado
      // ou Aprovada). Exclui "aguardando aprovacao" e "aprovado recalculado".
      const allStatuses = await prisma.moduleStatus.findMany({
        where: { company_id: company.id, module: 'os' },
        select: { id: true, name: true },
      })
      const approvedStatusIds = allStatuses
        .filter((s: { id: string; name: string }) => {
          const norm = s.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
          return /^aprovad[oa]$/.test(norm)
        })
        .map((s: { id: string; name: string }) => s.id)
      if (approvedStatusIds.length === 0) continue

      // Wave AG-3: carrega template customizado (se Karlao editou via UI).
      // Setting atraso_reparo.email_template tem o HTML completo c/ blocos embed.
      // Se nao existir, usa o default PECAS_EM_TRANSITO hardcoded.
      const customTemplateSetting = await prisma.setting.findFirst({
        where: { company_id: company.id, key: 'atraso_reparo.email_template' },
      })
      const customTemplateHtml = customTemplateSetting?.value || null
      const customTemplateSubject = (await prisma.setting.findFirst({
        where: { company_id: company.id, key: 'atraso_reparo.email_subject' },
      }))?.value || null

      // Karlao 2026-05-24: comparacao por DATA (nao DateTime). Prazo de hoje
      // (estimated_delivery = 2026-05-24 qualquer hora) so estoura no DIA
      // SEGUINTE (cron roda 08h, manda email na manha do dia apos estouro).
      const todayDateStart = new Date(now)
      todayDateStart.setHours(0, 0, 0, 0)

      const overdueOSs = await prisma.serviceOrder.findMany({
        where: {
          company_id: company.id,
          deleted_at: null,
          status_id: { in: approvedStatusIds },
          estimated_delivery: { lt: todayDateStart },
        },
        include: {
          customers: { select: { id: true, legal_name: true, email: true, mobile: true, phone: true, custom_data: true } },
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
          // Wave AE-3.2: respeitar opt-out do cliente (flag única do trio AE).
          // Cliente que clicou "Desativar lembretes" em /portal/[slug]/perfil
          // não recebe mais email/whatsapp do "Peças em trânsito".
          const customerCd = (os.customers.custom_data as Record<string, any> | null) || {}
          if (customerCd.disable_reminders === true) {
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

          // Karlao 2026-05-24: NOVA LOGICA — 1 email por estouro de prazo
          // (nao mais daily 1-14 + weekly).
          // - 1a vez (delay undefined OU prazo original ainda nao tinha new_eta):
          //   seta new_eta = hoje + 5 dias uteis e envia email
          // - 2a+ vez: SO envia se hoje > delay.new_eta (estouro DO NOVO prazo).
          //   Adiciona +5 dias uteis ao new_eta e envia email.
          //
          // Resultado pratico: cliente recebe 1 email no estouro original,
          // depois mais 1 email a cada 5 dias uteis enquanto OS continuar
          // "Aprovado". Sem spam diario.

          let shouldSend = false
          let updatedDelay: DelayState

          if (!delay) {
            // Primeiro estouro: prazo original estourou. Define novo prazo.
            const newEta = addBusinessDays(now, 5)
            newEta.setHours(0, 0, 0, 0)
            updatedDelay = {
              triggered_at: now.toISOString(),
              new_eta: newEta.toISOString(),
              daily_count: 1, // contador de quantas vezes enviou
              weekly_count: 0, // legado, nao usado mais
              last_sent_at: now.toISOString(),
              last_sent_kind: 'daily',
            }
            shouldSend = true
          } else {
            // Ja tem delay registrado. Checa se o NOVO prazo tambem estourou.
            const currentNewEta = new Date(delay.new_eta)
            currentNewEta.setHours(0, 0, 0, 0)
            const todayDate = new Date(now)
            todayDate.setHours(0, 0, 0, 0)

            if (todayDate <= currentNewEta) {
              // Novo prazo ainda nao estourou — nao manda email
              stats.skipped++
              continue
            }
            // Novo prazo tambem estourou — define mais um prazo (+5 dias uteis) e envia
            const nextEta = addBusinessDays(now, 5)
            nextEta.setHours(0, 0, 0, 0)
            updatedDelay = {
              ...delay,
              new_eta: nextEta.toISOString(),
              daily_count: (delay.daily_count || 0) + 1,
              last_sent_at: now.toISOString(),
              last_sent_kind: 'daily',
            }
            shouldSend = true
          }

          if (!shouldSend) {
            stats.skipped++
            continue
          }

          const newEta = new Date(updatedDelay.new_eta)
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
          // Wave AG-3: usa template customizado se Karlao editou via UI, senao hardcoded
          const tpl = customTemplateHtml
            ? {
                subject: customTemplateSubject || `OS #${os.os_number} — Atualização sobre seu reparo`,
                html: interpolateAtrasoHtml(customTemplateHtml, vars),
              }
            : PECAS_EM_TRANSITO(vars)
          await sendCompanyEmail(company.id, os.customers.email, tpl.subject, tpl.html).catch((e) => {
            console.warn(`[cron/atraso] email pecas falhou OS-${os.os_number}:`, e?.message)
          })

          await prisma.serviceOrderHistory.create({
            data: {
              company_id: company.id,
              service_order_id: os.id,
              from_status_id: os.status_id,
              to_status_id: os.status_id,
              changed_by: 'SYSTEM',
              notes: `📧 [Atraso #${updatedDelay.daily_count}] Email enviado a ${os.customers.email} — nova ETA ${vars.nova_eta}`,
            },
          }).catch(() => {})

          await prisma.serviceOrder.update({
            where: { id: os.id },
            data: { custom_data: { ...customData, delay: updatedDelay } as any },
          })

          if (updatedDelay.daily_count === 1) stats.dia0++
          else stats.daily++
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
