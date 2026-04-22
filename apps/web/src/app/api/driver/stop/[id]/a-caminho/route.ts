import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { createVisitToken } from '@/lib/visit-token'
import { sendWhatsAppCloud, sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'
import { rateLimit } from '@/lib/rate-limit'

/**
 * POST /api/driver/stop/[id]/a-caminho
 * Body: { eta_minutes?: number }  (default: calcula via distancia se GPS disponível)
 *
 * Acionado quando motorista clica "🚗 A caminho" no card da próxima parada.
 * Efeitos:
 *  1. Gera/atualiza visit_confirm_token
 *  2. Salva visit_notified_at + visit_eta_minutes
 *  3. Envia WhatsApp ao cliente com link de confirmação/remarcação
 *
 * Mensagem exemplo:
 *   "Olá, Maria! Seu técnico Emerson está a caminho, previsão 15 min.
 *    Confirme se estará disponível: [link]"
 *
 * Rate limit: 3 notificações por stop (evita cliente ser bombardeado
 * se o motorista clica várias vezes).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const rl = rateLimit(`a-caminho:${params.id}`, 3, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Cliente ja foi notificado recentemente' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const etaMinutes = Number.isFinite(body.eta_minutes) ? Math.max(1, Math.min(180, Math.round(body.eta_minutes))) : null

  const stop = await prisma.logisticsStop.findFirst({
    where: { id: params.id, company_id: auth.companyId },
    include: { route: { select: { driver_id: true } } },
  })
  if (!stop) return NextResponse.json({ error: 'Parada nao encontrada' }, { status: 404 })
  if (stop.status === 'COMPLETED' || stop.status === 'FAILED') {
    return NextResponse.json({ error: 'Parada ja finalizada' }, { status: 400 })
  }
  if (stop.route.driver_id && stop.route.driver_id !== auth.id && !auth.isSuperAdmin) {
    return NextResponse.json({ error: 'Parada atribuida a outro motorista' }, { status: 403 })
  }

  // Customer data + phone
  const osId = stop.os_id
  const os = osId ? await prisma.serviceOrder.findFirst({
    where: { id: osId, company_id: auth.companyId },
    select: {
      os_number: true,
      customers: { select: { legal_name: true, mobile: true, phone: true } },
    },
  }) : null
  const customerName = os?.customers?.legal_name || stop.customer_name || 'Cliente'
  const rawPhone = os?.customers?.mobile || os?.customers?.phone || stop.customer_phone || ''
  const phone = String(rawPhone).replace(/\D/g, '')

  // Company data pra link + mensagem
  const company = await prisma.company.findUnique({
    where: { id: auth.companyId },
    select: { slug: true, name: true },
  })
  if (!company?.slug) return NextResponse.json({ error: 'Empresa sem slug' }, { status: 500 })

  // Token e status. Token é criado na 1ª chamada; se já existe, reusa.
  let token = stop.visit_confirm_token
  if (!token) token = createVisitToken(stop.id)

  await prisma.logisticsStop.update({
    where: { id: params.id },
    data: {
      visit_confirm_token: token,
      visit_notified_at: new Date(),
      visit_eta_minutes: etaMinutes,
      status: stop.status === 'PENDING' ? 'EN_ROUTE' : stop.status,
    },
  })

  // Build link
  const PORTAL_DOMAIN_BY_SLUG: Record<string, string> = {
    pontualtech: 'portal.pontualtech.com.br',
    imprimitech: 'portal.imprimitech.com.br',
  }
  const portalHost = PORTAL_DOMAIN_BY_SLUG[company.slug] || `portal.${company.slug}.com.br`
  const link = `https://${portalHost}/portal/${company.slug}/visita/${token}`

  // Envia WhatsApp. Estrategia:
  //   1. TENTA TEMPLATE "pt_a_caminho_v1" primeiro — funciona fora da janela
  //      24h porque e template aprovado pelo Meta (pra empresas com Cloud
  //      API, caso da PontualTech).
  //   2. Se template falhar (nao registrado/aprovado), cai pra free text
  //      via sendWhatsAppCloud. Esse tem fallback automatico pra Evolution
  //      quando Cloud nao ta configurado (caso da Imprimitech).
  let waStatus: 'sent' | 'skipped_no_phone' | 'failed' = 'skipped_no_phone'
  let waError: string | null = null
  let waMethod: 'template' | 'free_text' | null = null
  if (phone && phone.length >= 10) {
    const firstName = customerName.split(' ')[0]
    const motoristaFirstName = auth.name.split(' ')[0]
    // IMPORTANTE: Meta bloqueia silenciosamente parametros iniciando
    // com espaco, tab ou newline (regra anti-spam nao documentada).
    // Sempre comecamos com pontuacao. Template tem '...esta a caminho{{3}}.',
    // entao {{3}} comeca com '.' vira '...caminho. Previsao...'
    const etaParam = etaMinutes ? `. Previsao: ${etaMinutes} min` : '.'
    const etaTextFreeform = etaMinutes ? `, previsao: ${etaMinutes} min` : ''
    const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`

    // Monta free text pra fallback (usado se template nao esta disponivel)
    const freeText =
      `Ola, ${firstName}!\n\n` +
      `Nosso motorista ${motoristaFirstName} esta a caminho${etaTextFreeform}.\n\n` +
      `Confirme sua disponibilidade ou solicite remarcar:\n${link}\n\n` +
      `— ${company.name}`

    // Tenta template primeiro (4 parametros: cliente, motorista, eta, link)
    const templateResult = await sendWhatsAppTemplate(
      auth.companyId, normalizedPhone, 'pt_a_caminho_v2', 'pt_BR',
      [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: motoristaFirstName },
          { type: 'text', text: etaParam },
          { type: 'text', text: link },
        ],
      }],
      freeText,  // fallback text pra Evolution se Cloud nao configurado
    )

    if (templateResult.success) {
      waStatus = 'sent'
      waMethod = 'template'
    } else {
      // Template falhou — tenta free text (funciona na janela 24h + Evolution)
      const freeTextResult = await sendWhatsAppCloud(auth.companyId, normalizedPhone, freeText)
      waStatus = freeTextResult.success ? 'sent' : 'failed'
      waMethod = freeTextResult.success ? 'free_text' : null
      waError = freeTextResult.success ? null : (
        `template: ${templateResult.error || 'falha'} | free_text: ${freeTextResult.error || 'falha'}`
      )
    }
  }

  return NextResponse.json({
    data: {
      stop_id: params.id,
      notified_at: new Date(),
      eta_minutes: etaMinutes,
      whatsapp: waStatus,
      whatsapp_method: waMethod, // 'template' | 'free_text' | null
      whatsapp_error: waError,
      confirmation_link: link, // motorista pode copiar se WA falhar
    },
  })
}
