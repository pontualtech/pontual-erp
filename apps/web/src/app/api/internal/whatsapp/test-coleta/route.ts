import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * POST /api/internal/whatsapp/test-coleta
 * Sends a known-working template (pt_coleta_v2) to test delivery path.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get('x-internal-key')
  const valid = [process.env.CRON_SECRET, process.env.CHATWOOT_WEBHOOK_SECRET].filter(Boolean)
  if (!key || !valid.includes(key)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { company_id, phone } = await req.json().catch(() => ({}))
  if (!company_id || !phone) return NextResponse.json({ error: 'need company_id and phone' }, { status: 400 })

  const settings = await prisma.setting.findMany({
    where: { company_id, key: { startsWith: 'whatsapp.cloud.' } },
  })
  const cfg: Record<string, string> = {}
  for (const s of settings) cfg[s.key] = s.value

  const token = cfg['whatsapp.cloud.access_token']
  const phoneNumberId = cfg['whatsapp.cloud.phone_number_id']

  const cleanPhone = String(phone).replace(/\D/g, '')
  const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

  const body = {
    messaging_product: 'whatsapp',
    to: formattedPhone,
    type: 'template',
    template: {
      name: 'pt_coleta_v2',
      language: { code: 'pt_BR' },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: '0000' }],
        },
      ],
    },
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()

  return NextResponse.json({ status: res.status, response: data })
}
