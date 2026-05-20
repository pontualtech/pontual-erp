// POST /api/internal/cron/evolution-zombie-check
//
// Detecta sessoes WhatsApp Baileys (Evolution API) "zumbis": state=open mas
// updatedAt congelado em horario comercial. 2 incidentes documentados em
// memoria (12/05 + 20/05, Vendas Imprimitech). Cron alerta Karlao por email
// antes do 3o incidente.
//
// === SETUP MANUAL APOS DEPLOY ===
// 1. Settings no banco (per-company com Evolution):
//    INSERT INTO settings (company_id, key, value) VALUES
//      ('86c829cf-32ed-4e40-80cd-59ce4178aa1a', 'whatsapp.evolution.api_url', 'https://api.imp.pontualtech.work'),
//      ('86c829cf-32ed-4e40-80cd-59ce4178aa1a', 'whatsapp.evolution.api_key', 'Lustos@22');
// 2. Cron externo a cada 30min (Coolify scheduler ou Linux cron):
//    curl -X POST https://erp.pontualtech.work/api/internal/cron/evolution-zombie-check \
//      -H "x-internal-key: $INTERNAL_API_KEY"
// 3. Email destino configuravel em COMPANY_CONTACTS abaixo.
//
// Threshold: 60min sem evento em horario comercial (8-19h BRT seg-sab).
// Fora desse range nao alerta (instances ficam naturalmente sem evento).
//
// Auth: header x-internal-key = $INTERNAL_API_KEY (mesmo pattern de outros crons).
//
// NAO faz auto-restart: prevencao de loop. Apenas alerta. Karlao decide
// se restarta via Coolify (POST /api/v1/services/<uuid>/restart).
//
// Trigger sugerido: cron Linux ou Coolify scheduler a cada 30min.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { sendCompanyEmail } from '@/lib/send-email'
import { logAudit } from '@/lib/audit'

const ZOMBIE_THRESHOLD_MIN = 60 // alerta se updatedAt > 60min em horario comercial
const COMPANY_CONTACTS: Record<string, string> = {
  'pontualtech-001': 'karlao@outlook.com',
  '86c829cf-32ed-4e40-80cd-59ce4178aa1a': 'karlao@outlook.com', // Imprimitech tambem alerta Karlao
}

function isBusinessHourBRT(): boolean {
  // 8h-19h BRT (UTC-3). Seg-Sab. Domingo nao alerta.
  const now = new Date()
  const brtHour = (now.getUTCHours() - 3 + 24) % 24
  const dayOfWeek = now.getUTCDay() // 0=dom, 6=sab
  if (dayOfWeek === 0) return false
  return brtHour >= 8 && brtHour < 19
}

interface EvoInstance {
  id: string
  name: string
  connectionStatus: string
  updatedAt: string
  _count?: { Message?: number }
}

async function fetchEvolutionInstances(apiUrl: string, apiKey: string): Promise<EvoInstance[] | null> {
  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/instance/fetchInstances`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.error(`[zombie-check] Evolution API ${apiUrl} retornou ${res.status}`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.error(`[zombie-check] Evolution API ${apiUrl} fetch falhou:`, err instanceof Error ? err.message : err)
    return null
  }
}

export async function POST(req: NextRequest) {
  const expectedKey = process.env.INTERNAL_API_KEY
  if (!expectedKey) {
    console.error('[zombie-check] INTERNAL_API_KEY nao configurado')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  if (req.headers.get('x-internal-key') !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isBusinessHourBRT()) {
    return NextResponse.json({ data: { skipped: true, reason: 'outside_business_hours' } })
  }

  // 1. Carrega configs Evolution de todas as companies (apenas as que tem URL+key configurados)
  const settings = await prisma.setting.findMany({
    where: { key: { in: ['whatsapp.evolution.api_url', 'whatsapp.evolution.api_key'] } },
    select: { company_id: true, key: true, value: true },
  })

  const configByCompany = new Map<string, { url?: string; key?: string }>()
  for (const s of settings) {
    const cfg = configByCompany.get(s.company_id) || {}
    if (s.key === 'whatsapp.evolution.api_url') cfg.url = s.value
    if (s.key === 'whatsapp.evolution.api_key') cfg.key = s.value
    configByCompany.set(s.company_id, cfg)
  }

  const zombiesFound: any[] = []
  const checked: any[] = []

  for (const [companyId, cfg] of configByCompany) {
    if (!cfg.url || !cfg.key) continue

    const instances = await fetchEvolutionInstances(cfg.url, cfg.key)
    if (!instances) {
      checked.push({ companyId, error: 'fetch_failed' })
      continue
    }

    for (const inst of instances) {
      const ageMin = Math.round((Date.now() - new Date(inst.updatedAt).getTime()) / 60000)
      const isZombie = inst.connectionStatus === 'open' && ageMin > ZOMBIE_THRESHOLD_MIN
      checked.push({ companyId, name: inst.name, state: inst.connectionStatus, ageMin, isZombie })
      if (isZombie) zombiesFound.push({ companyId, name: inst.name, id: inst.id, ageMin, messageCount: inst._count?.Message })
    }
  }

  // 2. Pra cada zombie: envia email + audit log. Dedupe via audit (so alerta
  // 1x a cada 4h por instance — evita spam quando cron roda repetido sem fix).
  let alertsSent = 0
  for (const z of zombiesFound) {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000)
    const recentAlert = await prisma.auditLog.findFirst({
      where: {
        company_id: z.companyId,
        action: 'evolution_zombie_alert',
        entity_id: z.id,
        created_at: { gte: fourHoursAgo },
      },
    })
    if (recentAlert) continue // ja alertou recente, skip

    const to = COMPANY_CONTACTS[z.companyId]
    if (to) {
      const html = `
        <p>Alerta automático do PontualERP:</p>
        <p><strong>Instância Evolution "${z.name}" em estado zombie.</strong></p>
        <ul>
          <li>Idade do último evento: <strong>${z.ageMin} minutos</strong></li>
          <li>Threshold: ${ZOMBIE_THRESHOLD_MIN} minutos</li>
          <li>Mensagens totais: ${z.messageCount ?? '?'}</li>
          <li>Phone Number ID: ${z.id}</li>
        </ul>
        <p><strong>Ação:</strong> restart container Coolify (mesmo padrão dos 2 incidentes anteriores).</p>
        <p>Comando:</p>
        <pre>curl -X POST "https://painel.pontualtech.work/api/v1/services/&lt;COOLIFY_SVC_UUID&gt;/restart" -H "Authorization: Bearer &lt;TOKEN&gt;"</pre>
        <p>Referência interna: <code>reference_evolution_zombie_session</code> em memory.</p>
      `
      try {
        await sendCompanyEmail(z.companyId, to, `[ALERTA] Evolution "${z.name}" zombie (${z.ageMin}min)`, html)
        alertsSent++
      } catch (err) {
        console.error(`[zombie-check] envio email falhou pra ${to}:`, err instanceof Error ? err.message : err)
      }
    }

    logAudit({
      companyId: z.companyId,
      userId: 'system:cron:zombie-check',
      module: 'integration',
      action: 'evolution_zombie_alert',
      entityId: z.id,
      newValue: { name: z.name, ageMin: z.ageMin, messageCount: z.messageCount },
    })
  }

  return NextResponse.json({
    data: {
      checked_instances: checked.length,
      zombies_found: zombiesFound.length,
      alerts_sent: alertsSent,
      zombies: zombiesFound.map(z => ({ company: z.companyId, name: z.name, ageMin: z.ageMin })),
      details: checked,
    },
  })
}
