import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * POST /api/admin/whatsapp/create-otp-template
 *
 * One-shot endpoint to register the OTP template in Meta WhatsApp Business.
 * Requires X-Internal-Key header.
 *
 * Body: { company_id: string }
 * Reads whatsapp.cloud.{access_token, business_account_id} from Settings.
 */
export async function POST(req: NextRequest) {
  const internalKey = req.headers.get('x-internal-key')
  const validKeys = [
    process.env.INTERNAL_API_KEY,
    process.env.BOT_WEBHOOK_SECRET,
    process.env.CRON_SECRET,
    process.env.CHATWOOT_WEBHOOK_SECRET,
  ].filter(Boolean)
  if (!internalKey || !validKeys.includes(internalKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { company_id } = await req.json().catch(() => ({}))
  if (!company_id) return NextResponse.json({ error: 'company_id obrigatorio' }, { status: 400 })

  const settings = await prisma.setting.findMany({
    where: { company_id, key: { startsWith: 'whatsapp.cloud.' } },
  })
  const cfg: Record<string, string> = {}
  for (const s of settings) cfg[s.key] = s.value

  const token = cfg['whatsapp.cloud.access_token']
  let wabaId = cfg['whatsapp.cloud.business_account_id'] || cfg['whatsapp.cloud.waba_id']
  const phoneNumberId = cfg['whatsapp.cloud.phone_number_id']

  if (!token) {
    return NextResponse.json({ error: 'Missing whatsapp.cloud.access_token' }, { status: 400 })
  }

  // Auto-discover WABA ID. Try multiple strategies.
  let discoveryDebug: any = { attempts: [] }
  if (!wabaId && phoneNumberId) {
    // Strategy 1: debug_token returns granular_scopes including WABA
    try {
      const dbgRes = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${token}&access_token=${token}`)
      const dbg = await dbgRes.json()
      discoveryDebug.attempts.push({ strategy: 'debug_token', response: dbg })
      const scopes = dbg?.data?.granular_scopes
      if (scopes) {
        for (const s of scopes) {
          if (s.scope === 'whatsapp_business_management' && s.target_ids?.length) {
            wabaId = s.target_ids[0]
            break
          }
        }
      }
    } catch (e: any) {
      discoveryDebug.attempts.push({ strategy: 'debug_token', error: String(e) })
    }

    // Strategy 2: GET /me?fields=... — also can return businesses
    if (!wabaId) {
      try {
        const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const d = await r.json()
        discoveryDebug.attempts.push({ strategy: 'phone_lookup', status: r.status, response: d })
        // Fallback — may not contain WABA
      } catch (e: any) {
        discoveryDebug.attempts.push({ strategy: 'phone_lookup', error: String(e) })
      }
    }
  }

  if (!wabaId) {
    return NextResponse.json({
      error: 'Cannot determine WABA ID',
      detail: { has_token: true, has_phone_id: !!phoneNumberId, phone_number_id: phoneNumberId, discovery: discoveryDebug },
    }, { status: 400 })
  }

  // Authentication template — approved in minutes, optimized for OTPs
  const templateBody = {
    name: 'pt_portal_otp',
    language: 'pt_BR',
    category: 'AUTHENTICATION',
    components: [
      {
        type: 'BODY',
        text: '{{1}} é seu código de acesso ao Portal do Cliente. Este código expira em 10 minutos.',
        add_security_recommendation: true,
        example: { body_text: [['123456']] },
      },
      {
        type: 'FOOTER',
        code_expiration_minutes: 10,
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'OTP',
            otp_type: 'COPY_CODE',
            text: 'Copiar código',
          },
        ],
      },
    ],
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(templateBody),
    })

    const data = await res.json()
    return NextResponse.json({
      success: res.ok,
      status: res.status,
      meta_response: data,
      template_name: 'pt_portal_otp',
    }, { status: res.ok ? 200 : 400 })
  } catch (err: any) {
    return NextResponse.json({ error: 'Meta API call failed', detail: String(err) }, { status: 500 })
  }
}
