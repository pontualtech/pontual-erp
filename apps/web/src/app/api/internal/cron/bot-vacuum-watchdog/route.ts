// POST /api/internal/cron/bot-vacuum-watchdog
//
// Watchdog de vácuo dos bots (auditoria 11/09 — leads de anúncio sem NENHUMA
// resposta): varre o Chatwoot de PT e IMP procurando conversas de bot cuja
// última mensagem pública é do CLIENTE há 5–120min sem resposta substantiva
// (notas privadas e holdings não contam — ver lib/bot/vacuum). Para cada uma:
//   1ª vez  → re-dispara o pipeline do bot (re-POST do webhook com payload
//             sintético da mensagem perdida; id novo pra passar o dedup de
//             last_message_id). Self-healing: cobre timeout do Dify, crash,
//             deploy no meio, lock preso, reopen pós-resolved.
//   2ª vez  → (re-disparo não resolveu) alerta: email ao dono + nota privada
//             na conversa. Dedup de alerta por conversa via auditLog (2h).
//
// Agendado via Coolify scheduled task (*/10min). Auth: x-internal-key.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { sendCompanyEmail } from '@/lib/send-email'
import { logAudit } from '@/lib/audit'
import { classifyVacuum } from '@/lib/bot/vacuum'

export const maxDuration = 120

const ALERT_EMAIL = 'karlao@outlook.com'

// Config mínima por tenant (mesmos envs/settings do pipeline do bot — os
// allowed_inboxes vêm dos MESMOS settings DB que o bot usa, nunca diverge).
const TENANTS = [
  {
    companyId: process.env.BOT_ANA_COMPANY_ID || 'pontualtech-001',
    cwDefault: 'https://chat.pontualtech.work',
    token: () => process.env.CHATWOOT_API_TOKEN || process.env.CW_ADMIN_TOKEN || '',
    secret: () => process.env.BOT_WEBHOOK_SECRET_PT || process.env.BOT_WEBHOOK_SECRET || '',
    bots: [
      { slug: 'pontualtech', prefix: 'bot.config.', defaultInboxes: '2,4,9' },
      { slug: 'pontualtech-suporte', prefix: 'bot.marta.config.', defaultInboxes: '2,4,9' },
    ],
  },
  {
    companyId: process.env.BOT_IMPRI_COMPANY_ID || '86c829cf-32ed-4e40-80cd-59ce4178aa1a',
    cwDefault: 'https://chat.imp.pontualtech.work',
    token: () => process.env.CW_IMPRI_TOKEN || '',
    secret: () => process.env.BOT_WEBHOOK_SECRET_IMP || process.env.BOT_WEBHOOK_SECRET || '',
    bots: [
      { slug: 'imprimitech', prefix: 'bot.config.', defaultInboxes: '2,4,9' },
      { slug: 'imprimitech-suporte', prefix: 'bot.aline.config.', defaultInboxes: '2,4,9' },
    ],
  },
]

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'

async function auditedRecently(companyId: string, action: string, entityId: string, minutes: number) {
  const since = new Date(Date.now() - minutes * 60 * 1000)
  const hit = await prisma.auditLog.findFirst({
    where: { company_id: companyId, action, entity_id: entityId, created_at: { gte: since } },
    select: { id: true },
  }).catch(() => null)
  return !!hit
}

export async function POST(req: NextRequest) {
  const expectedKey = process.env.INTERNAL_API_KEY
  if (!expectedKey) return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  if (req.headers.get('x-internal-key') !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const summary = { checked: 0, vacuums: 0, redispatched: 0, alerted: 0, errors: [] as string[] }

  for (const tenant of TENANTS) {
    const token = tenant.token()
    if (!token) { summary.errors.push(`${tenant.companyId}: sem token Chatwoot`); continue }

    // inbox -> slug do bot (settings DB, com fallback nos defaults do pipeline)
    const settings = await prisma.setting.findMany({
      where: { company_id: tenant.companyId, key: { in: tenant.bots.flatMap(b => [b.prefix + 'allowed_inboxes', b.prefix + 'cw_url', b.prefix + 'cw_account_id']) } },
    })
    const sv = (k: string) => settings.find(s => s.key === k)?.value
    const inboxToSlug = new Map<number, string>()
    for (const b of tenant.bots) {
      for (const id of (sv(b.prefix + 'allowed_inboxes') || b.defaultInboxes).split(',').map(Number)) {
        if (id && !inboxToSlug.has(id)) inboxToSlug.set(id, b.slug)
      }
    }
    const cwUrl = sv(tenant.bots[0].prefix + 'cw_url') || tenant.cwDefault
    const acct = sv(tenant.bots[0].prefix + 'cw_account_id') || '1'
    const cw = `${cwUrl}/api/v1/accounts/${acct}`
    const H = { api_access_token: token }

    try {
      // conversas abertas recentes (2 páginas ~50 convs cobrem 2h de atividade)
      const convs: any[] = []
      for (let page = 1; page <= 2; page++) {
        const r = await fetch(`${cw}/conversations?status=open&page=${page}`, { headers: H, signal: AbortSignal.timeout(20000) })
        if (!r.ok) break
        const rows = (await r.json())?.data?.payload || []
        convs.push(...rows)
        if (rows.length < 25) break
      }

      for (const c of convs) {
        const last = c.last_activity_at || 0
        if (nowSec - last < 4 * 60 || nowSec - last > 130 * 60) continue
        const slug = inboxToSlug.get(c.inbox_id)
        if (!slug) continue

        const botConv = await prisma.botConversation.findFirst({
          where: { chatwoot_conv_id: c.id, company_id: tenant.companyId },
          select: { id: true, human_takeover: true },
        })
        if (!botConv || botConv.human_takeover) continue
        summary.checked++

        const mr = await fetch(`${cw}/conversations/${c.id}/messages`, { headers: H, signal: AbortSignal.timeout(20000) })
        if (!mr.ok) continue
        const raw = (await mr.json())?.payload || []
        const msgs = raw
          .filter((m: any) => m.message_type === 0 || m.message_type === 1)
          .map((m: any) => ({
            type: m.message_type === 0 ? 'incoming' as const : 'outgoing' as const,
            private: !!m.private,
            content: m.content || '',
            created_at: m.created_at || 0,
          }))
        if (classifyVacuum(msgs, nowSec) !== 'vacuum') continue
        summary.vacuums++

        const lastInc = [...raw].reverse().find((m: any) => m.message_type === 0 && !m.private)
        if (!lastInc) continue
        const msgKey = `cw${c.id}-msg${lastInc.id}`

        if (!(await auditedRecently(tenant.companyId, 'bot_vacuum_redispatch', msgKey, 180))) {
          // 1ª vez: re-dispara o pipeline (id sintético passa o dedup de last_message_id)
          const payload = {
            event: 'message_created',
            message_type: 'incoming',
            private: false,
            id: Date.now(),
            content: lastInc.content || '',
            conversation: { id: c.id, inbox_id: c.inbox_id },
            inbox: { id: c.inbox_id },
            sender: { type: 'contact', id: lastInc.sender?.id, name: lastInc.sender?.name, phone_number: lastInc.sender?.phone_number },
          }
          const rp = await fetch(`${APP_URL}/api/chatwoot/bot?company=${slug}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Token': tenant.secret() },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(110000),
          }).catch((e) => ({ ok: false, status: 0, _err: e?.message } as any))
          logAudit({
            companyId: tenant.companyId,
            userId: 'system:cron:bot-vacuum-watchdog',
            module: 'bots',
            action: 'bot_vacuum_redispatch',
            entityId: msgKey,
            newValue: { conv: c.id, slug, status: (rp as any).status, content: (lastInc.content || '').slice(0, 120) },
          })
          summary.redispatched++
        } else if (!(await auditedRecently(tenant.companyId, 'bot_vacuum_alert', `cw${c.id}`, 120))) {
          // 2ª vez (re-disparo não resolveu): alerta dono + nota privada
          await fetch(`${cw}/conversations/${c.id}/messages`, {
            method: 'POST',
            headers: { ...H, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `[WATCHDOG] 🚨 Cliente sem resposta há ${Math.round((nowSec - lastInc.created_at) / 60)}min e o re-processo automático falhou. ASSUMIR MANUALMENTE. Msg: "${(lastInc.content || '').slice(0, 100)}"`, private: true }),
            signal: AbortSignal.timeout(15000),
          }).catch(() => null)
          try {
            await sendCompanyEmail(tenant.companyId, ALERT_EMAIL,
              `[Bot ${slug}] Cliente sem resposta (watchdog)`,
              `<p>Conversa <strong>#${c.id}</strong> (${slug}) está sem resposta há ${Math.round((nowSec - lastInc.created_at) / 60)}min e o re-processo automático não resolveu.</p><p>Última mensagem do cliente: "${(lastInc.content || '').slice(0, 200)}"</p><p><a href="${cwUrl}/app/accounts/${acct}/conversations/${c.id}">Abrir no Chatwoot</a></p>`)
          } catch (e: any) { summary.errors.push(`email conv ${c.id}: ${e?.message}`) }
          logAudit({
            companyId: tenant.companyId,
            userId: 'system:cron:bot-vacuum-watchdog',
            module: 'bots',
            action: 'bot_vacuum_alert',
            entityId: `cw${c.id}`,
            newValue: { conv: c.id, slug, msg: msgKey },
          })
          summary.alerted++
        }
      }
    } catch (e: any) {
      summary.errors.push(`${tenant.companyId}: ${e?.message}`)
    }
  }

  return NextResponse.json({ data: summary })
}
