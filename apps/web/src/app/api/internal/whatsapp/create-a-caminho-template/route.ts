import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * POST /api/internal/whatsapp/create-a-caminho-template
 *
 * Registra template "pt_a_caminho_v1" no Meta Business Manager da empresa.
 * Template UTILITY pra notificar cliente que o tecnico esta a caminho,
 * com link de confirmacao/remarcacao. Funciona fora da janela 24h
 * (diferente de free text).
 *
 * Body: { company_id: string, waba_id?: string }
 *
 * Template body (4 variaveis):
 *   Ola {{1}}! Seu tecnico {{2}} esta a caminho{{3}}.
 *
 *   Confirme sua disponibilidade ou solicite remarcar:
 *   {{4}}
 *
 * Onde:
 *   {{1}} = primeiro nome do cliente (ex: Maria)
 *   {{2}} = primeiro nome do motorista (ex: Emerson)
 *   {{3}} = " — previsao: 15 min" ou string vazia
 *   {{4}} = URL do portal pra confirmacao/remarcacao
 *
 * Apos aprovado (minutos a horas), o /api/driver/stop/[id]/a-caminho
 * usa este template via sendWhatsAppTemplate.
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
  if (!wabaId) return NextResponse.json({ error: 'Missing whatsapp.cloud.business_account_id (envie via body.waba_id ou configure settings)' }, { status: 400 })

  // v3: acrescenta BUTTONS com URL dinamica pro token de confirmacao.
  // Cliente toca no botao 'Confirmar / Remarcar' em vez de URL inline.
  // 3 body params + 1 button param (visita token).
  const templateBody = {
    name: 'pt_a_caminho_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Ola {{1}}! Nosso motorista {{2}} esta a caminho{{3}}.\n\nConfirme sua disponibilidade ou solicite remarcar no botao abaixo. Em caso de duvida, responda esta mensagem.',
        example: {
          body_text: [[
            'Maria',
            'Emerson',
            '. Previsao: 15 min',
          ]],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Confirmar ou Remarcar',
            url: 'https://portal.pontualtech.com.br/portal/pontualtech/visita/{{1}}',
            example: ['https://portal.pontualtech.com.br/portal/pontualtech/visita/abc123'],
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
      template_name: 'pt_a_caminho_v3',
      meta_response: data,
      next_step: res.ok
        ? 'Template registrado! Aprovacao do Meta leva alguns minutos. Status: PENDING -> APPROVED.'
        : 'Falha ao registrar — veja meta_response.error pra diagnosticar.',
    }, { status: res.ok ? 200 : 400 })
  } catch (err: any) {
    return NextResponse.json({ error: 'Meta API call failed', detail: String(err) }, { status: 500 })
  }
}
