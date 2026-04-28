import 'server-only'
import { prisma } from '@pontual/db'
import { createVisitToken } from './visit-token'
import { sendWhatsAppCloud, sendWhatsAppTemplate } from './whatsapp/cloud-api'
import { pauseBotForLogistics } from './bot/pause-for-logistics'

/**
 * Logica unica de "tecnico a caminho" — usada por:
 *   1. /api/driver/stop/[id]/a-caminho (motorista clica no app)
 *   2. /api/logistics/stops/[id]/notify-customer (atendente do ERP)
 *
 * Encapsula:
 *   - Validacao da parada (existe, nao finalizada)
 *   - Geracao/reuso de visit_confirm_token
 *   - Update de visit_notified_at + visit_eta_minutes + status EN_ROUTE
 *   - Envio WhatsApp com cascata: template v3 -> v2 -> free text
 *   - Pause do bot Ana/Aline na conversa pra atendente humano cuidar
 *
 * Invocadores devem garantir AUTH antes de chamar (driver/atendente check).
 * Se quiser bloquear "outro motorista", checa stop.route.driver_id antes.
 */

const PORTAL_DOMAIN_BY_SLUG: Record<string, string> = {
  pontualtech: 'portal.pontualtech.com.br',
  imprimitech: 'portal.imprimitech.com.br',
}

export type VisitNotificationResult = {
  ok: boolean
  error?: string
  status_code?: number
  data?: {
    stop_id: string
    notified_at: Date
    eta_minutes: number | null
    whatsapp: 'sent' | 'skipped_no_phone' | 'failed'
    whatsapp_method: 'template' | 'free_text' | null
    whatsapp_error: string | null
    confirmation_link: string
  }
}

export async function notifyCustomerOnTheWay(opts: {
  stopId: string
  companyId: string
  driverName: string  // primeiro nome aparece na msg ("Emerson esta a caminho")
  etaMinutes?: number | null
  /** Se a parada nao tem motorista atribuido OU se driver chamou e nao e o
   *  dono — passe falso pra burlar o check (atendente sempre pode notificar) */
  enforceDriverOwnership?: { driverId: string; isSuperAdmin?: boolean } | null
}): Promise<VisitNotificationResult> {
  const stop = await prisma.logisticsStop.findFirst({
    where: { id: opts.stopId, company_id: opts.companyId },
    include: { route: { select: { driver_id: true } } },
  })
  if (!stop) return { ok: false, error: 'Parada nao encontrada', status_code: 404 }
  if (stop.status === 'COMPLETED' || stop.status === 'FAILED') {
    return { ok: false, error: 'Parada ja finalizada', status_code: 400 }
  }
  // Check ownership so motorista alheio nao notifica
  if (opts.enforceDriverOwnership) {
    const { driverId, isSuperAdmin } = opts.enforceDriverOwnership
    if (stop.route.driver_id && stop.route.driver_id !== driverId && !isSuperAdmin) {
      return { ok: false, error: 'Parada atribuida a outro motorista', status_code: 403 }
    }
  }

  const etaMinutes = opts.etaMinutes != null && Number.isFinite(opts.etaMinutes)
    ? Math.max(1, Math.min(180, Math.round(opts.etaMinutes)))
    : null

  // Customer + phone
  const os = stop.os_id ? await prisma.serviceOrder.findFirst({
    where: { id: stop.os_id, company_id: opts.companyId },
    select: { customers: { select: { legal_name: true, mobile: true, phone: true } } },
  }) : null
  const customerName = os?.customers?.legal_name || stop.customer_name || 'Cliente'
  const rawPhone = os?.customers?.mobile || os?.customers?.phone || stop.customer_phone || ''
  const phone = String(rawPhone).replace(/\D/g, '')

  // Company
  const company = await prisma.company.findUnique({
    where: { id: opts.companyId },
    select: { slug: true, name: true },
  })
  if (!company?.slug) return { ok: false, error: 'Empresa sem slug', status_code: 500 }

  // Token (reuso se existir)
  let token = stop.visit_confirm_token
  if (!token) token = createVisitToken(stop.id)

  await prisma.logisticsStop.update({
    where: { id: opts.stopId },
    data: {
      visit_confirm_token: token,
      visit_notified_at: new Date(),
      visit_eta_minutes: etaMinutes,
      status: stop.status === 'PENDING' ? 'EN_ROUTE' : stop.status,
    },
  })

  const portalHost = PORTAL_DOMAIN_BY_SLUG[company.slug] || `portal.${company.slug}.com.br`
  const link = `https://${portalHost}/portal/${company.slug}/visita/${token}`

  let waStatus: 'sent' | 'skipped_no_phone' | 'failed' = 'skipped_no_phone'
  let waError: string | null = null
  let waMethod: 'template' | 'free_text' | null = null

  if (phone && phone.length >= 10) {
    const firstName = customerName.split(' ')[0]
    const motoristaFirstName = (opts.driverName || 'Tecnico').split(' ')[0]
    const etaParam = etaMinutes ? `. Previsao: ${etaMinutes} min` : '.'
    const etaTextFreeform = etaMinutes ? `, previsao: ${etaMinutes} min` : ''
    const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`

    const freeText =
      `Ola, ${firstName}!\n\n` +
      `Nosso motorista ${motoristaFirstName} esta a caminho${etaTextFreeform}.\n\n` +
      `Confirme sua disponibilidade ou solicite remarcar:\n${link}\n\n` +
      `— ${company.name}`

    // v3 (botao URL dinamica) -> v2 (link inline) -> free text
    const v3 = await sendWhatsAppTemplate(
      opts.companyId, normalizedPhone, 'pt_a_caminho_v3', 'pt_BR',
      [
        { type: 'body', parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: motoristaFirstName },
          { type: 'text', text: etaParam },
        ]},
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
      ],
      freeText,
    )
    let waResultFinal = v3
    if (!v3.success) {
      waResultFinal = await sendWhatsAppTemplate(
        opts.companyId, normalizedPhone, 'pt_a_caminho_v2', 'pt_BR',
        [{ type: 'body', parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: motoristaFirstName },
          { type: 'text', text: etaParam },
          { type: 'text', text: link },
        ]}],
        freeText,
      )
    }
    if (waResultFinal.success) {
      waStatus = 'sent'
      waMethod = 'template'
    } else {
      const ft = await sendWhatsAppCloud(opts.companyId, normalizedPhone, freeText)
      waStatus = ft.success ? 'sent' : 'failed'
      waMethod = ft.success ? 'free_text' : null
      waError = ft.success ? null : `template: ${waResultFinal.error || 'falha'} | free_text: ${ft.error || 'falha'}`
    }
  }

  // Pausa bot na conversa pra atendente humano cuidar
  if (waStatus === 'sent' && phone) {
    void pauseBotForLogistics(opts.companyId, phone, 'a-caminho').catch(() => {})
  }

  return {
    ok: true,
    data: {
      stop_id: opts.stopId,
      notified_at: new Date(),
      eta_minutes: etaMinutes,
      whatsapp: waStatus,
      whatsapp_method: waMethod,
      whatsapp_error: waError,
      confirmation_link: link,
    },
  }
}
