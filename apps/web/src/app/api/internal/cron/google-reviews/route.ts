import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { sendWhatsAppTemplate, sendWhatsAppCloud } from '@/lib/whatsapp/cloud-api'
import { sendCompanyEmail } from '@/lib/send-email'
import { getFeedbackEmail } from '@/lib/email-templates/feedback'
import crypto from 'crypto'

/**
 * Gera token HMAC pro link /cupom-avaliacao/[token]. Mesma logica do
 * endpoint publico — se o cliente clicar, ganha cupom e vai pro Google.
 *
 * C9 fix (audit): SEM fallback hardcoded 'fallback-dev-secret'. Atacante
 * que conheça essa string forjava tokens de cupom de qualquer customer.
 * Agora throw se ERP_TOKEN_SECRET ausente — boot quebra em deploy mal
 * configurado, sysadmin sabe consertar.
 */
function buildCouponToken(companyId: string, customerId: string): string {
  const secret = process.env.ERP_TOKEN_SECRET || process.env.CRON_SECRET
  if (!secret) {
    throw new Error('ERP_TOKEN_SECRET (ou CRON_SECRET fallback) ausente — configurar no Coolify')
  }
  const payload = Buffer.from(JSON.stringify({ c: companyId, u: customerId, t: Date.now() })).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function getBaseUrl(companyId: string): string {
  // Dominio `.work` parece ser filtrado pelo Meta (templates aceitos
  // mas nao entregues). Usa dominios `.com.br` do portal — mesmo app
  // via Traefik, mas credibilidade maior pro Meta.
  if (companyId === 'pontualtech-001') return 'https://portal.pontualtech.com.br'
  if (companyId === '86c829cf-32ed-4e40-80cd-59ce4178aa1a') return 'https://portal.imprimitech.com.br'
  return process.env.NEXT_PUBLIC_APP_URL || 'https://portal.pontualtech.com.br'
}

// Aliases que indicam "OS EFETIVAMENTE entregue ao cliente" (modulo OS).
// PontualTech: 'Entregue' (status final apos cliente receber).
// Imprimitech: 'Entregue Reparado' (idem, nomenclatura diferente).
//
// IMPORTANTE: 'Entregar Reparado' NAO entra aqui. Esse status significa
// "preparado pra entregar / pronto pra retirada" — OS ainda esta na loja
// aguardando cliente. Disparar review nesse momento e prematuro
// (decisao Karlao 2026-05-05 apos 16 OS receberem review antes de saida).
const DELIVERED_STATUS_ALIASES = ['Entregue', 'Entregue Reparado']

/**
 * POST /api/internal/cron/google-reviews
 *
 * Envia link de avaliacao do Google Meu Negocio + cupom 10% pra clientes
 * com OS em status "Entregue/Entregue Reparado". Trigger e baseado em
 * ServiceOrder (nao em LogisticsStop) — assim cobre QUALQUER caller que
 * marque a OS como entregue: motorista, atendente ERP, bot, portal.
 *
 * Criterios:
 *  - ServiceOrder.status_id em DELIVERED_STATUS_ALIASES (per-company)
 *  - actual_delivery >= 1min atras E < 48h atras
 *  - review_request_sent_at IS NULL
 *  - deleted_at IS NULL
 *  - Setting google_reviews.url configurado na empresa
 *  - Cliente com telefone valido (>= 10 digitos)
 *
 * Auto-backfill: se a OS tem stop antigo com reviews_sent_at populated
 * (flow pre-2026-05-05, baseado em LogisticsStop), copia o timestamp
 * pra service_orders.review_request_sent_at e skip — evita duplicar
 * envio pra cliente que ja recebeu.
 *
 * Roda via instrumentation.ts a cada 5 min.
 */
const WINDOW_MIN_MS = 1 * 60 * 1000        // >= 1min depois de entregar (Karlao: 2026-05-05)
const WINDOW_MAX_MS = 48 * 60 * 60 * 1000  // < 48h (entregas antigas sao ignoradas)

export async function POST(req: NextRequest) {
  // C9 fix (audit): aceitar APENAS INTERNAL_API_KEY. Antes aceitava 3 chaves
  // (INTERNAL_API_KEY OR CRON_SECRET OR BOT_WEBHOOK_SECRET) — se UMA vazasse
  // (ex: bot webhook em log do n8n), atacante disparava reviews com link
  // customizado. A chave mais fraca define a segurança do conjunto.
  const internalKey = req.headers.get('x-internal-key')
  const expectedKey = process.env.INTERNAL_API_KEY
  if (!expectedKey) {
    console.error('[Cron/google-reviews] INTERNAL_API_KEY não configurado')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  if (!internalKey || internalKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const maxDeliveredAt = new Date(now.getTime() - WINDOW_MIN_MS)
  const minDeliveredAt = new Date(now.getTime() - WINDOW_MAX_MS)

  // Pega TODAS as OS com actual_delivery na janela, sem review enviada.
  // Filtragem por status_id "delivered" e feita em codigo (per-company)
  // pra evitar query monstro com status_id IN (...) cross-company.
  const orders = await prisma.serviceOrder.findMany({
    where: {
      review_request_sent_at: null,
      deleted_at: null,
      actual_delivery: { gte: minDeliveredAt, lte: maxDeliveredAt },
    },
    take: 100,
    orderBy: { actual_delivery: 'asc' },
    select: {
      id: true, company_id: true, status_id: true, os_number: true,
      customer_id: true, actual_delivery: true,
      customers: { select: { legal_name: true, mobile: true, phone: true, email: true } },
    },
  })

  if (orders.length === 0) {
    return NextResponse.json({ data: { processed: 0, sent: 0, skipped: 0 } })
  }

  // Cache per-company: { reviewsUrl, deliveredIds[] }
  const companyCache = new Map<string, { reviewsUrl: string | null; deliveredIds: string[] }>()

  let sent = 0
  let skipped = 0
  const results: any[] = []

  for (const os of orders) {
    try {
      // === Auto-backfill ===
      // Se a OS ja tem stop com reviews_sent_at populated (cliente recebeu
      // via flow antigo baseado em LogisticsStop), copia o timestamp pro
      // service_orders.review_request_sent_at e skip. Evita duplicar envio.
      const oldStop = await prisma.logisticsStop.findFirst({
        where: { os_id: os.id, reviews_sent_at: { not: null } },
        select: { reviews_sent_at: true },
        orderBy: { reviews_sent_at: 'desc' },
      })
      if (oldStop?.reviews_sent_at) {
        await prisma.serviceOrder.update({
          where: { id: os.id },
          data: { review_request_sent_at: oldStop.reviews_sent_at },
        })
        skipped++
        results.push({ os_id: os.id, os_number: os.os_number, skipped: 'backfilled_from_old_stop' })
        continue
      }

      // === Cache: URL Google + status delivered da empresa ===
      let cache = companyCache.get(os.company_id)
      if (!cache) {
        const urlSetting = await prisma.setting.findFirst({
          where: { company_id: os.company_id, key: 'google_reviews.url' },
        })
        const deliveredStatuses = await prisma.moduleStatus.findMany({
          where: {
            company_id: os.company_id,
            module: 'os',
            name: { in: DELIVERED_STATUS_ALIASES },
          },
          select: { id: true },
        })
        cache = {
          reviewsUrl: urlSetting?.value || null,
          deliveredIds: deliveredStatuses.map(s => s.id),
        }
        companyCache.set(os.company_id, cache)
      }

      if (!cache.reviewsUrl) {
        skipped++
        results.push({ os_id: os.id, os_number: os.os_number, skipped: 'no_google_reviews_url' })
        continue
      }
      if (cache.deliveredIds.length === 0) {
        skipped++
        results.push({ os_id: os.id, os_number: os.os_number, skipped: 'no_delivered_status_configured' })
        continue
      }

      // === Status atual da OS DEVE ser um "delivered" ===
      // OS pode ter actual_delivery setado mas atendente moveu pra outro
      // status depois (ex: Garantia). Nao envia review nesse caso.
      if (!cache.deliveredIds.includes(os.status_id)) {
        skipped++
        results.push({ os_id: os.id, os_number: os.os_number, skipped: 'os_no_longer_delivered' })
        continue
      }

      // === Telefone valido ===
      const rawPhone = (os.customers?.mobile || os.customers?.phone || '').replace(/\D/g, '')
      if (!rawPhone || rawPhone.length < 10) {
        // Sem telefone — marca pra nao re-tentar (email fire-and-forget
        // ainda dispara abaixo se houver email)
        await prisma.serviceOrder.update({
          where: { id: os.id },
          data: { review_request_sent_at: new Date() },
        })
        skipped++
        results.push({ os_id: os.id, os_number: os.os_number, skipped: 'no_phone' })
        continue
      }
      const normalizedPhone = rawPhone.startsWith('55') ? rawPhone : `55${rawPhone}`
      const customerName = os.customers?.legal_name || 'Cliente'
      const firstName = customerName.split(' ')[0]

      // === Token cupom ===
      const customerId: string | null = os.customer_id || null
      const token = customerId ? buildCouponToken(os.company_id, customerId) : 'sem-token'
      const link = `${getBaseUrl(os.company_id)}/avaliar/${token}`
      const freeText = `Ola, ${firstName}! Gostariamos muito de ouvir sua opiniao sobre o atendimento. Toque no link para deixar seu feedback:\n\n${link}`

      // === Chain TEMPLATE-first (com botoes) ===
      // Decisao Karlao 2026-05-05 tarde: prefere mensagens com BOTAO clicavel
      // ("Deixar feedback") em vez de free-text com link inline. Mais
      // profissional + melhor CTR + visual mobile melhor.
      //
      // Ordem:
      // 1. pt_avaliacao_google_v3 (UTILITY, botao "Deixar feedback")
      //    - Categoria UTILITY = deliverability ~95%
      //    - Body neutro, sem mencionar oferta (regra Meta)
      // 2. pt_feedback_v1 (MARKETING, botao "Avaliar e ganhar 10%")
      //    - Body menciona desconto explicitamente
      //    - MARKETING tem mais filtragem Meta-side, fica como fallback
      // 3. free-text com link inline
      //    - Ultimo recurso quando ambos templates falharem
      //    - Fica sem botao (link no body)
      let r = await sendWhatsAppTemplate(
        os.company_id, normalizedPhone, 'pt_avaliacao_google_v3', 'pt_BR',
        [
          { type: 'body', parameters: [{ type: 'text', text: firstName }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
        ],
        freeText,
      )
      let channelUsed: 'pt_avaliacao_google_v3' | 'pt_feedback_v1' | 'free_text' | null =
        r.success ? 'pt_avaliacao_google_v3' : null

      if (!r.success) {
        r = await sendWhatsAppTemplate(
          os.company_id, normalizedPhone, 'pt_feedback_v1', 'pt_BR',
          [
            { type: 'body', parameters: [{ type: 'text', text: firstName }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
          ],
          freeText,
        )
        if (r.success) channelUsed = 'pt_feedback_v1'
      }
      if (!r.success) {
        // Ultimo recurso: free-text. Sem botao, link no corpo.
        r = await sendWhatsAppCloud(os.company_id, normalizedPhone, freeText)
        if (r.success) channelUsed = 'free_text'
      }

      // === E-mail paralelo (fire-and-forget) ===
      // Independente do resultado WhatsApp — multi-canal cobre falhas Meta.
      const customerEmail = os.customers?.email || null
      if (customerEmail) {
        void (async () => {
          try {
            const company = await prisma.company.findUnique({
              where: { id: os.company_id },
              select: { name: true },
            })
            const tpl = await getFeedbackEmail(os.company_id, {
              cliente: customerName,
              empresa: company?.name || 'PontualTech',
              os_number: os.os_number,
              link,
            })
            await sendCompanyEmail(os.company_id, customerEmail, tpl.subject, tpl.html)
          } catch (err) {
            console.warn('[reviews] email falhou:', err instanceof Error ? err.message : String(err))
          }
        })()
      }

      if (r.success) {
        await prisma.serviceOrder.update({
          where: { id: os.id },
          data: { review_request_sent_at: new Date() },
        })
        sent++
        // Loga qual canal deu certo — possibilita medir CTR real e priorizar
        // canais por deliverability efetiva ao longo do tempo.
        console.log(`[Cron/GoogleReviews] OS ${os.os_number} sent via ${channelUsed} to ${normalizedPhone.slice(0, 4)}***`)
        results.push({ os_id: os.id, os_number: os.os_number, sent: true, channel: channelUsed })
      } else {
        // Falhou WA — NAO marca review_request_sent_at, tenta de novo no
        // proximo tick ate completar 48h
        skipped++
        results.push({ os_id: os.id, os_number: os.os_number, skipped: 'wa_failed', error: r.error })
      }
    } catch (err: any) {
      skipped++
      results.push({ os_id: os.id, os_number: os.os_number, skipped: 'exception', error: String(err?.message || err) })
    }
  }

  return NextResponse.json({
    data: { processed: orders.length, sent, skipped, details: results.slice(0, 20) },
  })
}
