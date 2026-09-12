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

  const geradoEm = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const html = buildBriefingHtml({ geradoEm, empresas, infra })
  const status = probeStatus(infra)
  const alertasTot = empresas.reduce((s, e) => s + e.watchdog.alertas, 0)
  const subject = `${status === '🔴' ? '🚨' : alertasTot > 0 ? '⚠️' : '⛵'} Relatório do Comandante — ${now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`

  let emailed = false
  try {
    await sendCompanyEmail(EMPRESAS[0].id, ALERT_EMAIL, subject, html)
    emailed = true
  } catch (err) {
    console.error('[daily-briefing] email falhou:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ data: { emailed, infra, empresas } })
}
