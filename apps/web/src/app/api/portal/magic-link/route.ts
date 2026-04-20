import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { createAccessToken } from '@/lib/portal-auth'
import { rateLimit } from '@/lib/rate-limit'
import { sendWhatsAppCloud } from '@/lib/whatsapp/cloud-api'

/**
 * POST /api/portal/magic-link
 *
 * Generates a one-click login link for a customer.
 * Caller can be:
 *   1. Authenticated operator (ERP user with permission 'os.edit')
 *   2. Bot (via X-Internal-Key header matching INTERNAL_API_KEY)
 *
 * Body: { customer_id: string, redirect?: string }
 *   - customer_id: UUID of the customer (must belong to caller's company)
 *   - redirect: optional path to redirect after auto-login (e.g., "/portal/impri/os/abc")
 *
 * Returns: { url: "https://erp.pontualtech.work/portal/{slug}/entrar?t=TOKEN&r=..." }
 *   Link is valid for 48 hours and sets a 7-day session cookie on click.
 */
export async function POST(req: NextRequest) {
  try {
    let companyId: string
    const internalKey = req.headers.get('x-internal-key')

    if (internalKey && internalKey === process.env.INTERNAL_API_KEY) {
      // Bot/webhook call — must provide company_id in body
      const body = await req.json()
      if (!body.company_id) {
        return NextResponse.json({ error: 'company_id obrigatorio para chamadas internas' }, { status: 400 })
      }
      companyId = body.company_id

      return buildLinkResponse(companyId, body.customer_id, body.redirect, undefined, body.send_via_wa)
    }

    // Operator call — validate ERP session + permission
    const auth = await requirePermission('os', 'edit')
    if (auth instanceof NextResponse) return auth
    companyId = auth.companyId

    const body = await req.json()
    return buildLinkResponse(companyId, body.customer_id, body.redirect, auth.id, body.send_via_wa)
  } catch (err) {
    console.error('[MagicLink] Error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

async function buildLinkResponse(
  companyId: string,
  customerId: string,
  redirect?: string,
  userId?: string,
  sendViaWa?: boolean,
) {
  if (!customerId) {
    return NextResponse.json({ error: 'customer_id obrigatorio' }, { status: 400 })
  }

  // Rate limit: max 20 magic links per hour per requester scope
  const scopeKey = userId ? `user:${userId}` : `company:${companyId}`
  const rl = rateLimit(`magic-link:${scopeKey}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Limite de geracao de links excedido' }, { status: 429 })
  }

  // Validate customer belongs to company
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, company_id: companyId, deleted_at: null },
    select: { id: true, legal_name: true, mobile: true, phone: true },
  })
  if (!customer) {
    return NextResponse.json({ error: 'Cliente nao encontrado nesta empresa' }, { status: 404 })
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { slug: true, name: true },
  })
  if (!company) {
    return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })
  }

  const token = createAccessToken(customerId, companyId)

  // Build URL using tenant-specific portal domain when available
  const isImpri = company.slug.includes('imprimitech')
  const portalDomain = isImpri ? 'portal.imprimitech.com.br' : 'portal.pontualtech.com.br'
  const portalBase = process.env.PORTAL_URL || `https://${portalDomain}`

  const url = new URL(`${portalBase}/portal/${company.slug}/entrar`)
  url.searchParams.set('t', token)
  if (redirect) url.searchParams.set('r', redirect)

  // Optionally push the link to the customer's WhatsApp directly
  // (Meta Cloud if configured, else Evolution fallback — transparent to caller)
  let waResult: { attempted: boolean; success?: boolean; channel?: string; error?: string } = { attempted: false }
  if (sendViaWa) {
    const phone = customer.mobile || customer.phone
    if (!phone) {
      waResult = { attempted: true, success: false, error: 'Cliente sem telefone cadastrado' }
    } else {
      const firstName = (customer.legal_name || '').split(' ')[0] || 'Cliente'
      const text = `Olá, ${firstName}!\n\nAqui está seu acesso direto ao portal do cliente da ${company.name}:\n\n${url.toString()}\n\nLink válido por 48 horas. Nenhuma senha necessária — basta clicar.`
      const sent = await sendWhatsAppCloud(companyId, String(phone).replace(/\D/g, ''), text)
      waResult = {
        attempted: true,
        success: sent.success,
        channel: sent.success ? 'whatsapp' : undefined,
        error: sent.success ? undefined : (sent.error || 'Falha ao enviar'),
      }
    }
  }

  return NextResponse.json({
    data: {
      url: url.toString(),
      expires_in_hours: 48,
      customer_name: customer.legal_name,
      company_name: company.name,
      wa: waResult,
    },
  })
}
