import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

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
  const wabaId = cfg['whatsapp.cloud.business_account_id']
  if (!token || !wabaId) return NextResponse.json({ error: 'not configured' }, { status: 400 })

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${wabaId}/message_templates?fields=name,status,category,language,components&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()

  // Summary: just names, status, has_buttons
  const summary = (data.data || []).map((t: any) => ({
    name: t.name,
    status: t.status,
    category: t.category,
    language: t.language,
    has_buttons: t.components?.some((c: any) => c.type === 'BUTTONS'),
    button_types: t.components?.find((c: any) => c.type === 'BUTTONS')?.buttons?.map((b: any) => b.type || b.sub_type),
  }))

  return NextResponse.json({ count: data.data?.length || 0, templates: summary, raw: data })
}
