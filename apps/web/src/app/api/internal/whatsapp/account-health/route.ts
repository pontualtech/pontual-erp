import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * GET /api/internal/whatsapp/account-health
 * Checks account-level issues: billing, throughput, messaging limits, restrictions.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get('x-internal-key')
  const valid = [process.env.CRON_SECRET, process.env.CHATWOOT_WEBHOOK_SECRET].filter(Boolean)
  if (!key || !valid.includes(key)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { company_id } = await req.json().catch(() => ({}))
  const settings = await prisma.setting.findMany({
    where: { company_id, key: { startsWith: 'whatsapp.cloud.' } },
  })
  const cfg: Record<string, string> = {}
  for (const s of settings) cfg[s.key] = s.value

  const token = cfg['whatsapp.cloud.access_token']
  const phoneNumberId = cfg['whatsapp.cloud.phone_number_id']
  const wabaId = cfg['whatsapp.cloud.business_account_id']

  const reports: any = {}

  // 1. Full phone number info
  const r1 = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,messaging_limit_tier,throughput,status,name_status,account_mode,search_visibility,is_official_business_account,is_on_biz_app,certificate`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  reports.phone = { status: r1.status, data: await r1.json() }

  // 2. WABA account info - business verification, review status
  const r2 = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}?fields=name,business_verification_status,account_review_status,message_template_namespace,currency,timezone_id,primary_funding_id,on_behalf_of_business_info`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  reports.waba = { status: r2.status, data: await r2.json() }

  // 3. Analytics on conversations (delivery signals)
  const now = Math.floor(Date.now() / 1000)
  const r3 = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}?fields=analytics.start(${now - 3600}).end(${now}).granularity(HALF_HOUR)`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  reports.analytics = { status: r3.status, data: await r3.json() }

  // 4. Conversational analytics - look for blocks/failures
  const r4 = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}?fields=conversation_analytics.start(${now - 3600}).end(${now}).granularity(HALF_HOUR).dimensions(["CONVERSATION_CATEGORY","CONVERSATION_DIRECTION","CONVERSATION_TYPE","PHASE"])`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  reports.conversation_analytics = { status: r4.status, data: await r4.json() }

  return NextResponse.json(reports)
}
