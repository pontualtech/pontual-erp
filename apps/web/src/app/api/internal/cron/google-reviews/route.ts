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
      equipment_type: true, equipment_brand: true, equipment_model: true,
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
      // v7 (07/30): personaliza com o equipamento ({{2}}). Fallback 'equipamento'.
      const equipamento = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ') || 'equipamento'

      // === Token cupom ===
      const customerId: string | null = os.customer_id || null
      const token = customerId ? buildCouponToken(os.company_id, customerId) : 'sem-token'
      const link = `${getBaseUrl(os.company_id)}/avaliar/${token}`
      const freeText = `Ola, ${firstName}! Gostariamos muito de ouvir sua opiniao sobre o atendimento. Toque no link para deixar seu feedback:\n\n${link}`

      // === Chain TEMPLATE-first (com botoes) ===
      // Decisao Karlao 2026-05-05 tarde: prefere mensagens com BOTAO clicavel
      // em vez de free-text com link inline. Mais profissional + melhor CTR.
      //
      // 2026-05-25: trocado v3 por v5. 2026-06-22: trocado v5 -> v6.
      // v5 (e v1/v2/feedback_v1) sao MARKETING na Meta (lideram com cupom 10%);
      // enviar proativo sem opt-in reabre o flag de spam (caso 10/06). v6 e
      // UTILITY: texto neutro de feedback, SEM cupom/Google/desconto na msg —
      // o cupom aparece so no clique (pagina /avaliar). Meta classificou como
      // UTILITY, entao entrega transacional, sem opt-in e sem risco de flag.
      //
      // Ordem:
      // 1. pt_avaliacao_google_v6 (UTILITY, botao "Deixar feedback")
      //    - Mensagem neutra; incentivo (cupom) revelado apos o clique
      // 2. free-text com link inline
      //    - Ultimo recurso quando template falhar (so vale dentro da janela 24h)
      //    - Fica sem botao (link no body)
      let r = await sendWhatsAppTemplate(
        os.company_id, normalizedPhone, 'pt_avaliacao_google_v7', 'pt_BR',
        [
          { type: 'body', parameters: [{ type: 'text', text: firstName }, { type: 'text', text: equipamento }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
        ],
        freeText,
      )
      let channelUsed: 'pt_avaliacao_google_v7' | 'free_text' | null =
        r.success ? 'pt_avaliacao_google_v7' : null

      if (!r.success) {
        // Fallback: free-text com link inline (sem botao, mas garante entrega).
        // pt_feedback_v1 removido da chain em 2026-05-25 — também violava policy.
        r = await sendWhatsAppCloud(os.company_id, normalizedPhone, freeText)
        if (r.success) channelUsed = 'free_text'
      }

      // === E-mail (multi-canal) ===
      // 2026-06-22 FIX: ANTES era fire-and-forget e o review_request_sent_at
      // so era marcado no sucesso do WhatsApp. Cliente com WA falhando + email
      // valido nunca era marcado -> o email reenviava a CADA tick (5min) por
      // 48h. Caso real: OS 60874-76 (Jaime Ginzburg) ~1700 emails. Agora
      // aguardamos o email e marcamos a OS se QUALQUER canal (WA OU email)
      // contatou o cliente — assim nao reenvia.
      const customerEmail = os.customers?.email || null
      let emailSent = false
      if (customerEmail) {
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
          emailSent = true
        } catch (err) {
          console.warn('[reviews] email falhou:', err instanceof Error ? err.message : String(err))
        }
      }

      if (r.success || emailSent) {
        // Contatado por ALGUM canal -> marca pra nao reenviar. Sem este
        // `|| emailSent`, WA falhando + email ok = spam a cada tick (ver acima).
        await prisma.serviceOrder.update({
          where: { id: os.id },
          data: { review_request_sent_at: new Date() },
        })
        sent++
        const channel = channelUsed || (emailSent ? 'email' : null)
        // Loga qual canal deu certo — possibilita medir CTR real e priorizar
        // canais por deliverability efetiva ao longo do tempo.
        console.log(`[Cron/GoogleReviews] OS ${os.os_number} sent via ${channel} to ${normalizedPhone.slice(0, 4)}***`)
        results.push({ os_id: os.id, os_number: os.os_number, sent: true, channel })
      } else {
        // Nem WA nem email (cliente sem email e WA falhou) — NAO marca,
        // tenta de novo no proximo tick ate completar 48h
        skipped++
        results.push({ os_id: os.id, os_number: os.os_number, skipped: 'wa_and_email_failed', error: r.error })
      }
    } catch (err: any) {
      skipped++
      results.push({ os_id: os.id, os_number: os.os_number, skipped: 'exception', error: String(err?.message || err) })
    }
  }

  // ===== PASSE 2: LEMBRETE 1-2 dias depois (07/30) =====
  // Recupera parte dos ~77% que ignoram a 1a mensagem. UM unico lembrete,
  // SO pra quem NAO clicou (sem cupom review). WhatsApp UTILITY (template
  // lembrete_v1), sem free-text agressivo. Nao mexe no passe principal acima.
  const remMin = new Date(now.getTime() - 48 * 60 * 60 * 1000) // review enviado ha >= 24h
  const remMax = new Date(now.getTime() - 24 * 60 * 60 * 1000) //   e <= 48h
  let reminded = 0
  const reminderOrders = await prisma.serviceOrder.findMany({
    where: {
      review_request_sent_at: { gte: remMin, lte: remMax },
      review_reminder_sent_at: null,
      deleted_at: null,
    },
    take: 100,
    orderBy: { review_request_sent_at: 'asc' },
    select: {
      id: true, company_id: true, os_number: true, customer_id: true,
      equipment_type: true, equipment_brand: true, equipment_model: true,
      customers: { select: { legal_name: true, mobile: true, phone: true } },
    },
  })
  for (const os of reminderOrders) {
    try {
      // Ja clicou (tem cupom review)? Nao precisa lembrete — marca p/ parar de checar.
      if (os.customer_id) {
        const clicked = await prisma.coupon.findFirst({
          where: { company_id: os.company_id, customer_id: os.customer_id, source: 'review' },
          select: { id: true },
        })
        if (clicked) {
          await prisma.serviceOrder.update({ where: { id: os.id }, data: { review_reminder_sent_at: new Date() } })
          continue
        }
      }
      let cache = companyCache.get(os.company_id)
      if (!cache) {
        const urlSetting = await prisma.setting.findFirst({ where: { company_id: os.company_id, key: 'google_reviews.url' } })
        cache = { reviewsUrl: urlSetting?.value || null, deliveredIds: [] }
        companyCache.set(os.company_id, cache)
      }
      if (!cache.reviewsUrl) continue // empresa sem review configurado
      const rawPhone = (os.customers?.mobile || os.customers?.phone || '').replace(/\D/g, '')
      if (!rawPhone || rawPhone.length < 10) {
        await prisma.serviceOrder.update({ where: { id: os.id }, data: { review_reminder_sent_at: new Date() } })
        continue
      }
      const normalizedPhone = rawPhone.startsWith('55') ? rawPhone : `55${rawPhone}`
      const firstName = (os.customers?.legal_name || 'Cliente').split(' ')[0]
      const equipamento = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ') || 'equipamento'
      const token = os.customer_id ? buildCouponToken(os.company_id, os.customer_id) : 'sem-token'
      const link = `${getBaseUrl(os.company_id)}/avaliar/${token}`
      const freeText = `Ola, ${firstName}! Passando so pra lembrar: sua opiniao sobre o reparo do seu ${equipamento} e muito importante pra gente. Toque no link e conte como foi:\n\n${link}`
      const rr = await sendWhatsAppTemplate(
        os.company_id, normalizedPhone, 'pt_avaliacao_google_lembrete_v1', 'pt_BR',
        [
          { type: 'body', parameters: [{ type: 'text', text: firstName }, { type: 'text', text: equipamento }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
        ],
        freeText,
      )
      if (rr.success) {
        await prisma.serviceOrder.update({ where: { id: os.id }, data: { review_reminder_sent_at: new Date() } })
        reminded++
        console.log(`[Cron/GoogleReviews] LEMBRETE OS ${os.os_number} -> ${normalizedPhone.slice(0, 4)}***`)
      }
      // Falha: NAO marca — tenta de novo enquanto estiver na janela 24-48h.
    } catch (err) {
      console.warn(`[reviews/lembrete] OS ${os.os_number} falhou:`, err instanceof Error ? err.message : String(err))
    }
  }

  return NextResponse.json({
    data: { processed: orders.length, sent, skipped, reminded, details: results.slice(0, 20) },
  })
}
