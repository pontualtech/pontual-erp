import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * POST /api/internal/whatsapp/check-delivery
 * Queries the WABA to see phone quality, message status, and delivery issues.
 * Body: { company_id }
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get('x-internal-key')
  const valid = [process.env.CRON_SECRET, process.env.CHATWOOT_WEBHOOK_SECRET].filter(Boolean)
  if (!key || !valid.includes(key)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { company_id } = await req.json().catch(() => ({}))
  if (!company_id) return NextResponse.json({ error: 'company_id required' }, { status: 400 })

  const settings = await prisma.setting.findMany({
    where: { company_id, key: { startsWith: 'whatsapp.cloud.' } },
  })
  const cfg: Record<string, string> = {}
  for (const s of settings) cfg[s.key] = s.value

  const token = cfg['whatsapp.cloud.access_token']
  const phoneNumberId = cfg['whatsapp.cloud.phone_number_id']
  const wabaId = cfg['whatsapp.cloud.business_account_id']
  if (!token || !phoneNumberId) return NextResponse.json({ error: 'not configured' }, { status: 400 })

  // 1. Phone number quality + messaging_limit + display name
  const phoneRes = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=verified_name,code_verification_status,display_phone_number,quality_rating,messaging_limit_tier,throughput,status,name_status`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const phoneData = await phoneRes.json()

  // 2. Template status
  let templateData: any = null
  if (wabaId) {
    const tmplRes = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=pt_portal_otp`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    templateData = await tmplRes.json()
  }

  return NextResponse.json({
    phone: phoneData,
    template: templateData,
  })
}
