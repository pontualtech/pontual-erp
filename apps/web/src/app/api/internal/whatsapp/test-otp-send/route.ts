import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * POST /api/internal/whatsapp/test-otp-send
 * Directly tests WhatsApp template send and returns Meta's raw response.
 * Body: { company_id, phone, test_code? }
 */
export async function POST(req: NextRequest) {
  const internalKey = req.headers.get('x-internal-key')
  const valid = [process.env.CRON_SECRET, process.env.CHATWOOT_WEBHOOK_SECRET].filter(Boolean)
  if (!internalKey || !valid.includes(internalKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { company_id, phone, test_code = '123456' } = await req.json().catch(() => ({}))
  if (!company_id || !phone) {
    return NextResponse.json({ error: 'company_id and phone required' }, { status: 400 })
  }

  const settings = await prisma.setting.findMany({
    where: { company_id, key: { startsWith: 'whatsapp.cloud.' } },
  })
  const cfg: Record<string, string> = {}
  for (const s of settings) cfg[s.key] = s.value

  const token = cfg['whatsapp.cloud.access_token']
  const phoneNumberId = cfg['whatsapp.cloud.phone_number_id']
  if (!token || !phoneNumberId) {
    return NextResponse.json({ error: 'WA Cloud not configured', keys: Object.keys(cfg) }, { status: 400 })
  }

  const cleanPhone = String(phone).replace(/\D/g, '')
  const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

  const body = {
    messaging_product: 'whatsapp',
    to: formattedPhone,
    type: 'template',
    template: {
      name: 'pt_portal_otp',
      language: { code: 'pt_BR' },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: test_code }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: test_code }],
        },
      ],
    },
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()
    return NextResponse.json({
      request_body: body,
      phone_used: formattedPhone,
      meta_status: res.status,
      meta_response: data,
    })
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
