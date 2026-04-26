import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * Configura webhook do Meta WhatsApp Cloud API programaticamente
 * para o WABA da company informada.
 *
 * O que ESTE endpoint faz:
 *  1. Le access_token + waba_id das settings
 *  2. POST /{waba_id}/subscribed_apps — assina o app aos eventos do WABA
 *  3. Retorna o estado atual de inscricao
 *
 * O que FICA fora do escopo (precisa ser feito no Meta Business Suite manualmente):
 *  - Configurar a URL do webhook + verify_token no painel do APP
 *    (essa configuracao exige app_id + app_secret que nao temos no DB)
 *
 * Auth: x-internal-key = CRON_SECRET ou CHATWOOT_WEBHOOK_SECRET
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get('x-internal-key')
  const valid = [process.env.CRON_SECRET, process.env.CHATWOOT_WEBHOOK_SECRET].filter(Boolean)
  if (!key || !valid.includes(key)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { company_id } = body
  if (!company_id) return NextResponse.json({ error: 'company_id obrigatorio' }, { status: 400 })

  const settings = await prisma.setting.findMany({
    where: { company_id, key: { startsWith: 'whatsapp.cloud.' } },
  })
  const cfg: Record<string, string> = {}
  for (const s of settings) cfg[s.key] = s.value

  const token = cfg['whatsapp.cloud.access_token']
  const wabaId = cfg['whatsapp.cloud.business_account_id']
  if (!token || !wabaId) return NextResponse.json({ error: 'Cloud API nao configurado pra essa empresa' }, { status: 400 })

  const results: any = {}

  // 1) Verifica subscribed_apps atual
  try {
    const checkRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const checkData = await checkRes.json()
    results.before = { http: checkRes.status, data: checkData }
  } catch (e: any) {
    results.before = { error: e.message }
  }

  // 2) POST subscribed_apps (idempotente — se ja inscrito, retorna success)
  try {
    const subRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const subData = await subRes.json()
    results.subscribe = { http: subRes.status, data: subData }
  } catch (e: any) {
    results.subscribe = { error: e.message }
  }

  // 3) Verifica subscribed_apps novamente
  try {
    const checkRes2 = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const checkData2 = await checkRes2.json()
    results.after = { http: checkRes2.status, data: checkData2 }
  } catch (e: any) {
    results.after = { error: e.message }
  }

  // 4) Tenta listar webhook subscriptions (info adicional)
  try {
    const overRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}?fields=id,name,owner_business_info,subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const overData = await overRes.json()
    results.waba_overview = { http: overRes.status, data: overData }
  } catch (e: any) {
    results.waba_overview = { error: e.message }
  }

  return NextResponse.json({
    waba_id: wabaId,
    company_id,
    webhook_target_url: 'https://erp.pontualtech.work/api/webhook/meta-status',
    verify_token_env: process.env.META_WEBHOOK_VERIFY_TOKEN ? 'configured' : 'NOT_CONFIGURED',
    results,
    note: 'Se subscribe.data.success=true, o WABA esta inscrito ao app. A URL do webhook em si precisa estar configurada no painel do APP do Meta Business — esse endpoint nao pode setar isso (exige app_id+app_secret).',
  })
}
