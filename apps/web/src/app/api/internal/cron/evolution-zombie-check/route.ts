// POST /api/internal/cron/evolution-zombie-check
//
// WATCHDOG self-healing do Evolution (WhatsApp Baileys). Reescrito 20/08 —
// antes so ALERTAVA por email usando `updatedAt` (sinal NAO confiavel: state
// fica "open" no zumbi e updatedAt so bumpa com mensagem => quieta parecia
// morta). Agora:
//   1. SONDA ATIVA por instancia: POST /chat/whatsappNumbers (round-trip real
//      ao WhatsApp), com ate 3 tentativas p/ absorver blip de rede.
//   2. AUTO-CURA: se qualquer instancia da company estiver morta -> restart do
//      container Evolution via Coolify API -> re-sonda ate ~90s.
//   3. ESCALA: email pro Karlao SO se o restart nao recuperar (raro = sessao
//      expirou, precisa reescanear QR). Sucesso e silencioso (sem spam).
//
// Config per-company em `settings`:
//   whatsapp.evolution.api_url / api_key                          (ja existiam)
//   whatsapp.evolution.coolify_service_uuid / coolify_api_url /
//     coolify_api_token                                           (p/ auto-restart)
// Sem coolify_* -> cai no comportamento antigo (so email).
//
// Anti-thrash: nao restarta a mesma company > 1x/2h (audit log). Se ja
// restartou recente e ainda esta morta -> escala email direto (nao re-restarta).
//
// Agendado via Coolify scheduled task a cada 30min (24/7). Auth: x-internal-key.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { sendCompanyEmail } from '@/lib/send-email'
import { logAudit } from '@/lib/audit'
import { isAliveProbe } from '@/lib/whatsapp/evolution-health'

const PROBE_NUMBER = '5511966385774' // numero p/ o round-trip (o proprio da IMP)
const PROBE_TRIES = 3
const RESTART_DEDUP_MIN = 120 // nao re-restarta a mesma company dentro de 2h
const ALERT_DEDUP_MIN = 120
const REVERIFY_MAX_MS = 90_000
const REVERIFY_STEP_MS = 15_000

const COMPANY_CONTACTS: Record<string, string> = {
  'pontualtech-001': 'karlao@outlook.com',
  '86c829cf-32ed-4e40-80cd-59ce4178aa1a': 'karlao@outlook.com',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const trim = (u: string) => u.replace(/\/$/, '')

interface EvoCfg {
  apiUrl?: string
  apiKey?: string
  coolifyUuid?: string
  coolifyUrl?: string
  coolifyToken?: string
}

async function fetchInstanceNames(apiUrl: string, apiKey: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${trim(apiUrl)}/instance/fetchInstances`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const arr = Array.isArray(data) ? data : []
    return arr.map((it: any) => (it.instance || it).instanceName || (it.instance || it).name).filter(Boolean)
  } catch {
    return null
  }
}

// true = socket vivo (round-trip ok em alguma das tentativas)
async function probeInstance(apiUrl: string, apiKey: string, instanceName: string): Promise<boolean> {
  for (let i = 0; i < PROBE_TRIES; i++) {
    try {
      const res = await fetch(`${trim(apiUrl)}/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ numbers: [PROBE_NUMBER] }),
        signal: AbortSignal.timeout(20000),
      })
      const body = await res.text()
      if (isAliveProbe(res.ok, body)) return true
    } catch {
      /* timeout/rede — tenta de novo */
    }
    if (i < PROBE_TRIES - 1) await sleep(4000)
  }
  return false
}

// Sonda todas as instancias. Retorna nomes das MORTAS (API inalcancavel =
// tudo morto -> sinaliza com marcador '<api-unreachable>').
async function findDeadInstances(cfg: EvoCfg): Promise<string[]> {
  const names = await fetchInstanceNames(cfg.apiUrl!, cfg.apiKey!)
  if (names === null) return ['<api-unreachable>']
  if (names.length === 0) return []
  const dead: string[] = []
  for (const name of names) {
    const alive = await probeInstance(cfg.apiUrl!, cfg.apiKey!, name)
    if (!alive) dead.push(name)
  }
  return dead
}

async function restartCoolify(cfg: EvoCfg): Promise<boolean> {
  try {
    const res = await fetch(`${trim(cfg.coolifyUrl!)}/services/${cfg.coolifyUuid}/restart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.coolifyToken}` },
      signal: AbortSignal.timeout(30000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function recentAudit(companyId: string, action: string, minutes: number): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60 * 1000)
  const hit = await prisma.auditLog.findFirst({
    where: { company_id: companyId, action, created_at: { gte: since } },
    select: { id: true },
  }).catch(() => null)
  return !!hit
}

async function alertEmail(companyId: string, subject: string, html: string) {
  const to = COMPANY_CONTACTS[companyId]
  if (!to) return
  if (await recentAudit(companyId, 'evolution_watchdog_alert', ALERT_DEDUP_MIN)) return // dedupe
  try {
    await sendCompanyEmail(companyId, to, subject, html)
  } catch (err) {
    console.error('[evolution-watchdog] email falhou:', err instanceof Error ? err.message : err)
  }
  logAudit({
    companyId,
    userId: 'system:cron:evolution-watchdog',
    module: 'integration',
    action: 'evolution_watchdog_alert',
    entityId: companyId,
    newValue: { subject },
  })
}

export async function POST(req: NextRequest) {
  const expectedKey = process.env.INTERNAL_API_KEY
  if (!expectedKey) {
    console.error('[evolution-watchdog] INTERNAL_API_KEY nao configurado')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  if (req.headers.get('x-internal-key') !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Carrega config Evolution + Coolify de todas as companies
  const settings = await prisma.setting.findMany({
    where: { key: { startsWith: 'whatsapp.evolution.' } },
    select: { company_id: true, key: true, value: true },
  })
  const byCompany = new Map<string, EvoCfg>()
  for (const s of settings) {
    const cfg = byCompany.get(s.company_id) || {}
    if (s.key === 'whatsapp.evolution.api_url') cfg.apiUrl = s.value
    else if (s.key === 'whatsapp.evolution.api_key') cfg.apiKey = s.value
    else if (s.key === 'whatsapp.evolution.coolify_service_uuid') cfg.coolifyUuid = s.value
    else if (s.key === 'whatsapp.evolution.coolify_api_url') cfg.coolifyUrl = s.value
    else if (s.key === 'whatsapp.evolution.coolify_api_token') cfg.coolifyToken = s.value
    byCompany.set(s.company_id, cfg)
  }

  const results: any[] = []

  for (const [companyId, cfg] of byCompany) {
    if (!cfg.apiUrl || !cfg.apiKey) continue

    const dead = await findDeadInstances(cfg)
    if (dead.length === 0) {
      results.push({ companyId, status: 'healthy' })
      continue
    }

    const hasCoolify = !!(cfg.coolifyUuid && cfg.coolifyUrl && cfg.coolifyToken)
    if (!hasCoolify) {
      await alertEmail(
        companyId,
        `[ALERTA] Evolution WhatsApp caiu (${dead.join(', ')})`,
        `<p>Instancias sem resposta: <strong>${dead.join(', ')}</strong>. Sem config de auto-restart (coolify_*) — restart manual necessario.</p>`,
      )
      results.push({ companyId, status: 'dead_no_autoheal', dead })
      continue
    }

    // Anti-thrash: ja restartou nas ultimas 2h e ainda morto -> nao re-restarta, escala
    if (await recentAudit(companyId, 'evolution_auto_restart', RESTART_DEDUP_MIN)) {
      await alertEmail(
        companyId,
        `[ALERTA] Evolution ainda morto apos restart (${dead.join(', ')})`,
        `<p>O container foi restartado nas ultimas 2h mas <strong>${dead.join(', ')}</strong> segue sem responder. Provavel sessao expirada — precisa reescanear o QR no Evolution.</p>`,
      )
      results.push({ companyId, status: 'dead_after_recent_restart', dead })
      continue
    }

    // Restart + re-verifica
    const restartOk = await restartCoolify(cfg)
    logAudit({
      companyId,
      userId: 'system:cron:evolution-watchdog',
      module: 'integration',
      action: 'evolution_auto_restart',
      entityId: cfg.coolifyUuid!,
      newValue: { dead, restartRequestOk: restartOk },
    })
    if (!restartOk) {
      await alertEmail(
        companyId,
        `[ALERTA] Falha ao restartar Evolution (${dead.join(', ')})`,
        `<p>Instancias mortas: <strong>${dead.join(', ')}</strong>. A chamada de restart no Coolify FALHOU (token expirado?). Restart manual necessario.</p>`,
      )
      results.push({ companyId, status: 'restart_failed', dead })
      continue
    }

    // Re-sonda ate recuperar (container leva ~15-90s)
    let healed = false
    const deadline = Date.now() + REVERIFY_MAX_MS
    while (Date.now() < deadline) {
      await sleep(REVERIFY_STEP_MS)
      const stillDead = await findDeadInstances(cfg)
      if (stillDead.length === 0) {
        healed = true
        break
      }
    }

    if (healed) {
      results.push({ companyId, status: 'self_healed', dead })
    } else {
      await alertEmail(
        companyId,
        `[ALERTA] Restart do Evolution nao recuperou (${dead.join(', ')})`,
        `<p>Restartei o container mas <strong>${dead.join(', ')}</strong> segue sem responder apos ~90s. Provavel sessao expirada — precisa reescanear o QR no Evolution.</p>`,
      )
      results.push({ companyId, status: 'restarted_not_recovered', dead })
    }
  }

  return NextResponse.json({ data: { checked: results.length, results } })
}
