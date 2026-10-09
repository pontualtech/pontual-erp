// POST /api/internal/cron/daily-briefing
//
// Relatório Diário do Comandante (12/09/2026): email único às 08h BRT com a
// saúde das duas empresas nas últimas 24h — bots (conversas/erros/watchdog),
// operação (OS novas + prontas aguardando), financeiro (conciliação pendente,
// mesmo critério do alerta semanal) e infra (probes HTTP). Consolidado pro
// dono; empresas seguem 100% independentes em serviços/dados de clientes.
//
// Agendado via Coolify scheduled task (0 11 * * * UTC = 08h BRT). Auth: x-internal-key.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { sendCompanyEmail } from '@/lib/send-email'
import { receivableAlertLevel } from '@/lib/finance/conciliacao-alert'
import { buildBriefingHtml, probeStatus, type EmpresaBriefing, type InfraProbe } from '@/lib/briefing/daily'
import { avaliarSaudeWhatsapp } from '@/lib/briefing/whatsapp-health'

export const maxDuration = 120

const ALERT_EMAIL = 'karlao@outlook.com'
const EMPRESAS = [
  { id: process.env.BOT_ANA_COMPANY_ID || 'pontualtech-001', nome: 'PontualTech' },
  { id: process.env.BOT_IMPRI_COMPANY_ID || '86c829cf-32ed-4e40-80cd-59ce4178aa1a', nome: 'Imprimitech' },
]
const PRONTA_RE = /pront|entregar|retirar/i
const PROBES = [
  { nome: 'ERP', url: 'https://erp.pontualtech.work' },
  { nome: 'Dify PT (Ana/Marta)', url: 'https://dify.pontualtech.work' },
  { nome: 'Dify IMP (Grazi/Aline)', url: 'https://dify.imprimitech.com.br' },
  { nome: 'Chatwoot PT', url: 'https://chat.pontualtech.work' },
  { nome: 'Chatwoot IMP', url: 'https://chat.imp.pontualtech.work' },
]

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Conta mensagens de saída "failed" nas conversas ativas das últimas 24h (máx. 30 conversas). */
async function contarFalhasEntregaChatwoot(companyId: string): Promise<{ total: number; erro: string } | undefined> {
  try {
    const cfg = await prisma.setting.findMany({
      where: { company_id: companyId, key: { in: ['bot.config.cw_url', 'bot.config.cw_account_id'] } },
      select: { key: true, value: true },
    })
    const url = cfg.find(s => s.key === 'bot.config.cw_url')?.value
    const account = cfg.find(s => s.key === 'bot.config.cw_account_id')?.value || '1'
    const token = process.env.CHATWOOT_API_TOKEN || process.env.CW_ADMIN_TOKEN
    if (!url || !token) return undefined

    const base = `${url.replace(/\/$/, '')}/api/v1/accounts/${account}`
    const headers = { api_access_token: token }
    const desde = Date.now() / 1000 - 24 * 3600
    const lista = await fetch(`${base}/conversations?status=all&sort_by=last_activity_at_desc&page=1`, { headers, signal: AbortSignal.timeout(15000) }).then(r => r.json())
    const convs = ((lista.data?.payload || []) as any[]).filter(c => c.last_activity_at >= desde).slice(0, 30)

    let total = 0
    let erro = ''
    for (const c of convs) {
      const m = await fetch(`${base}/conversations/${c.id}/messages`, { headers, signal: AbortSignal.timeout(15000) }).then(r => r.json())
      for (const msg of (m.payload || []) as any[]) {
        if (msg.message_type !== 1 || msg.private || msg.status !== 'failed' || msg.created_at < desde) continue
        total++
        if (!erro) erro = String(msg.content_attributes?.external_error || msg.external_error || 'erro de entrega').slice(0, 80)
      }
    }
    return { total, erro }
  } catch (err) {
    console.error('[daily-briefing] falhas de entrega Chatwoot:', err instanceof Error ? err.message : err)
    return undefined
  }
}

async function checarWhatsappPT(companyId: string): Promise<string[]> {
  const settings = await prisma.setting.findMany({
    where: {
      company_id: companyId,
      key: { in: ['whatsapp.cloud.access_token', 'whatsapp.cloud.business_account_id', 'bot.followup.enabled', 'whatsapp.notifications.marketing_enabled'] },
    },
    select: { key: true, value: true },
  })
  const get = (k: string) => settings.find(s => s.key === k)?.value || ''
  const token = get('whatsapp.cloud.access_token')
  const wabaId = get('whatsapp.cloud.business_account_id')

  let waba: { canSend: string; erros: string[] } | null = null
  let phones: { nome: string; status: string; quality: string }[] = []
  if (token && wabaId) {
    try {
      const [w, p] = await Promise.all([
        fetch(`${GRAPH}/${wabaId}?fields=health_status&access_token=${token}`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
        fetch(`${GRAPH}/${wabaId}/phone_numbers?fields=display_phone_number,status,quality_rating&access_token=${token}`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      ])
      if (w.health_status) {
        const entidade = (w.health_status.entities || []).find((e: any) => e.entity_type === 'WABA')
        waba = {
          canSend: w.health_status.can_send_message,
          erros: (entidade?.errors || []).map((e: any) => `[${e.error_code}] ${String(e.error_description || '').slice(0, 80)}`),
        }
      }
      phones = (p.data || []).map((x: any) => ({ nome: x.display_phone_number, status: x.status, quality: x.quality_rating }))
    } catch (err) {
      console.error('[daily-briefing] Meta Graph falhou:', err instanceof Error ? err.message : err)
    }
  }

  // Sinal confiável de restrição: a Meta não expõe a restrição por spam na API,
  // mas o envio falha com 131031 — o Chatwoot marca essas mensagens como failed.
  const falhasEntrega24h = await contarFalhasEntregaChatwoot(companyId)

  return avaliarSaudeWhatsapp({
    phones,
    waba,
    falhasEntrega24h,
    followupLigado: get('bot.followup.enabled') === 'true',
    marketingLigado: get('whatsapp.notifications.marketing_enabled') === 'true',
  })
}

export async function POST(req: NextRequest) {
  const expectedKey = process.env.INTERNAL_API_KEY
  if (!expectedKey) return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  if (req.headers.get('x-internal-key') !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const desde = new Date(now.getTime() - 24 * 3600_000)

  const empresas: EmpresaBriefing[] = []
  for (const emp of EMPRESAS) {
    const [turnos, erros, transferidos, conversas, redispatches, alertas, criadas] = await Promise.all([
      prisma.chatbotLog.count({ where: { company_id: emp.id, created_at: { gte: desde } } }),
      prisma.chatbotLog.count({ where: { company_id: emp.id, created_at: { gte: desde }, status: 'error' } }),
      prisma.chatbotLog.count({ where: { company_id: emp.id, created_at: { gte: desde }, status: 'transferred' } }),
      prisma.botConversation.count({ where: { company_id: emp.id, updated_at: { gte: desde } } }),
      prisma.auditLog.count({ where: { company_id: emp.id, action: 'bot_vacuum_redispatch', created_at: { gte: desde } } }),
      prisma.auditLog.count({ where: { company_id: emp.id, action: 'bot_vacuum_alert', created_at: { gte: desde } } }),
      prisma.serviceOrder.count({ where: { company_id: emp.id, created_at: { gte: desde } } }),
    ])

    // OS prontas aguardando: status atual cujo nome indica pronta/entregar/retirar
    const statuses = await prisma.moduleStatus.findMany({
      where: { company_id: emp.id, module: 'os' },
      select: { id: true, name: true },
    })
    const prontaIds = statuses.filter(s => PRONTA_RE.test(s.name || '')).map(s => s.id)
    const prontas = prontaIds.length
      ? await prisma.serviceOrder.count({ where: { company_id: emp.id, status_id: { in: prontaIds }, deleted_at: null } })
      : 0

    // Conciliação pendente (mesmo critério do alerta semanal)
    const ars = await prisma.accountReceivable.findMany({
      where: {
        company_id: emp.id,
        status: { in: ['RECEBIDO', 'LIQUIDADO', 'PAGO'] },
        reconciled: false, deleted_at: null, received_amount: { gt: 0 },
      },
      select: { status: true, reconciled: true, received_amount: true, deleted_at: true, created_at: true, payment_method: true, service_order_id: true },
      take: 500,
    })
    const osIds = [...new Set(ars.map(a => a.service_order_id).filter((x): x is string => !!x))]
    const paidSet = new Set<string>()
    if (osIds.length) {
      const paid = await prisma.payment.findMany({
        where: { service_order_id: { in: osIds }, status: { in: ['CONFIRMED', 'RECEIVED'] } },
        select: { service_order_id: true },
      })
      for (const p of paid) if (p.service_order_id) paidSet.add(p.service_order_id)
    }
    let concHigh = 0, concWatch = 0
    for (const ar of ars) {
      const lvl = receivableAlertLevel(ar, ar.service_order_id ? paidSet.has(ar.service_order_id) : false, now.getTime())
      if (lvl === 'high') concHigh++
      else if (lvl === 'watch') concWatch++
    }

    empresas.push({
      nome: emp.nome,
      bots: { conversas, turnos, erros, transferidos },
      watchdog: { redispatches, alertas },
      os: { criadas24h: criadas, prontasAguardando: prontas },
      financeiro: { concHigh, concWatch },
    })
  }

  const infra: InfraProbe[] = await Promise.all(PROBES.map(async p => {
    try {
      const r = await fetch(p.url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) })
      return { nome: p.nome, ok: r.status < 500 }
    } catch {
      return { nome: p.nome, ok: false }
    }
  }))

  // Sentinela WhatsApp (09/10/2026): só a PontualTech usa Meta Cloud (IMP é Evolution).
  const whatsapp = await checarWhatsappPT(EMPRESAS[0].id)

  const geradoEm = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const html = buildBriefingHtml({ geradoEm, empresas, infra, whatsapp })
  const status = probeStatus(infra)
  const alertasTot = empresas.reduce((s, e) => s + e.watchdog.alertas, 0)
  const subject = `${status === '🔴' || whatsapp.length > 0 ? '🚨' : alertasTot > 0 ? '⚠️' : '⛵'} Relatório do Comandante — ${now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`

  let emailed = false
  try {
    await sendCompanyEmail(EMPRESAS[0].id, ALERT_EMAIL, subject, html)
    emailed = true
  } catch (err) {
    console.error('[daily-briefing] email falhou:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ data: { emailed, infra, empresas } })
}
