import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * POST /api/internal/whatsapp/create-avaliacao-google-template
 *
 * Cria pt_avaliacao_google_v1 no Meta. Mensagem enviada ~10min
 * apos entrega aprovada (Entregue Reparado) pedindo avaliacao.
 * 2 params: nome_cliente, link_avaliacao.
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

  const body = await req.json().catch(() => ({}))
  const { company_id, waba_id: wabaIdFromBody } = body
  if (!company_id) return NextResponse.json({ error: 'company_id obrigatorio' }, { status: 400 })

  const settings = await prisma.setting.findMany({
    where: { company_id, key: { startsWith: 'whatsapp.cloud.' } },
  })
  const cfg: Record<string, string> = {}
  for (const s of settings) cfg[s.key] = s.value
  const token = cfg['whatsapp.cloud.access_token']
  const wabaId = wabaIdFromBody || cfg['whatsapp.cloud.business_account_id'] || cfg['whatsapp.cloud.waba_id']
  if (!token) return NextResponse.json({ error: 'Missing whatsapp.cloud.access_token' }, { status: 400 })
  if (!wabaId) return NextResponse.json({ error: 'Missing whatsapp.cloud.business_account_id' }, { status: 400 })

  const templateBody = {
    name: 'pt_avaliacao_google_v1',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Ola {{1}}! Esperamos que tenha gostado do nosso atendimento. Que tal deixar uma avaliacao rapida no Google? Leva menos de 1 minuto: {{2}}\n\nSeu feedback ajuda muito! Em caso de duvida, responda esta mensagem.',
        example: {
          body_text: [['Maria', 'https://g.page/r/XXXXXX/review']],
        },
      },
    ],
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(templateBody),
    })
    const data = await res.json()
    return NextResponse.json({
      success: res.ok,
      status: res.status,
      template_name: 'pt_avaliacao_google_v1',
      meta_response: data,
    }, { status: res.ok ? 200 : 400 })
  } catch (err: any) {
    return NextResponse.json({ error: 'Meta API call failed', detail: String(err) }, { status: 500 })
  }
}
