import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createAccessToken } from '@/lib/portal-auth'
import { sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'

/**
 * POST /api/internal/whatsapp/test-status-v2
 * Sends pontualtech_status_os_v2 with magic-link to verify end-to-end flow.
 * Body: { company_id, phone, os_number?, equipment? }
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get('x-internal-key')
  const valid = [process.env.CRON_SECRET, process.env.CHATWOOT_WEBHOOK_SECRET].filter(Boolean)
  if (!key || !valid.includes(key)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { company_id, phone, os_number = '6030', equipment = 'Impressora Teste', status = 'Pronto para retirada' } = await req.json().catch(() => ({}))
  if (!company_id || !phone) return NextResponse.json({ error: 'company_id and phone required' }, { status: 400 })

  // Find customer by phone — to create a valid magic-link token
  const phoneDigits = String(phone).replace(/\D/g, '')
  const phoneNoCC = phoneDigits.startsWith('55') ? phoneDigits.slice(2) : phoneDigits
  const customer = await prisma.customer.findFirst({
    where: {
      company_id,
      deleted_at: null,
      OR: [{ mobile: { contains: phoneNoCC } }, { phone: { contains: phoneNoCC } }],
    },
  })
  if (!customer) return NextResponse.json({ error: 'customer not found' }, { status: 404 })

  const magicToken = createAccessToken(customer.id, company_id)

  const result = await sendWhatsAppTemplate(
    company_id,
    phoneDigits,
    'pontualtech_status_os_v2',
    'pt_BR',
    [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: String(os_number) },
          { type: 'text', text: status },
          { type: 'text', text: equipment },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: magicToken }],
      },
    ],
  )

  return NextResponse.json({
    result,
    magic_link_preview: `https://portal.pontualtech.com.br/portal/pontualtech/entrar?t=${magicToken.slice(0, 30)}...`,
    customer_name: customer.legal_name,
  })
}
