import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { sendWhatsAppTemplate, sendWhatsAppCloud } from '@/lib/whatsapp/cloud-api'
import { findStatusByName } from '@/lib/module-status'
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

/**
 * POST /api/internal/cron/google-reviews
 *
 * Envia link de avaliacao do Google Meu Negocio ~10min apos o
 * motorista finalizar uma entrega APROVADA (Entregue Reparado).
 *
 * Criterios:
 *  - LogisticsStop.type = ENTREGA
 *  - status = COMPLETED
 *  - completed_at >= 10min atras E < 48h atras (evita reviver stops velhos)
 *  - reviews_sent_at IS NULL
 *  - OS em status 'Entregue Reparado' (nao envia para recusadas)
 *  - Setting google_reviews.url configurado na empresa
 *
 * Roda via instrumentation.ts a cada 5 min.
 */
const WINDOW_MIN_MS = 1 * 60 * 1000        // >= 1min depois de entregar (Karlao: 2026-05-05)
const WINDOW_MAX_MS = 48 * 60 * 60 * 1000  // < 48h (stops antigos sao ignorados)

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
  const maxCompletedAt = new Date(now.getTime() - WINDOW_MIN_MS)
  const minCompletedAt = new Date(now.getTime() - WINDOW_MAX_MS)

  const stops = await prisma.logisticsStop.findMany({
    where: {
      type: 'ENTREGA',
      status: 'COMPLETED',
      reviews_sent_at: null,
      completed_at: { gte: minCompletedAt, lte: maxCompletedAt },
    },
    take: 100,
    orderBy: { completed_at: 'asc' },
    select: {
      id: true, company_id: true, os_id: true, customer_name: true,
      customer_phone: true, completed_at: true,
    },
  })

  if (stops.length === 0) {
    return NextResponse.json({ data: { processed: 0, sent: 0, skipped: 0 } })
  }

  // Cache por empresa: url + status 'Entregue Reparado' id
  const companyCache = new Map<string, { reviewsUrl: string | null; entregueReparadoId: string | null }>()

  let sent = 0
  let skipped = 0
  const results: any[] = []

  for (const stop of stops) {
    try {
      let cache = companyCache.get(stop.company_id)
      if (!cache) {
        const urlSetting = await prisma.setting.findFirst({
          where: { company_id: stop.company_id, key: 'google_reviews.url' },
        })
        // Ordem dos aliases DEVE bater com a do driver/entrega:
        //   apps/web/src/app/api/driver/stop/[id]/entrega/route.ts (linha ~199-204)
        // PontualTech tem 'Entregue' (sem 'Entregue Reparado'); Imprimitech
        // tem 'Entregue Reparado' (sem 'Entregue'). Se a ordem aqui divergir
        // do driver, o cron resolve pra um status_id diferente do que o
        // motorista setou na OS — e o equality check mais abaixo (linha ~144)
        // sempre falha em silencio (skip 'os_not_entregue_reparado').
        const entregueStatus = await findStatusByName(
          stop.company_id, 'os', 'Entregue', 'Entregue Reparado', 'Entregar Reparado',
        )
        cache = {
          reviewsUrl: urlSetting?.value || null,
          entregueReparadoId: entregueStatus?.id || null,
        }
        companyCache.set(stop.company_id, cache)
      }

      if (!cache.reviewsUrl || !cache.entregueReparadoId) {
        // sem url configurada OU sem status de entrega aprovada — pula mas
        // marca pra nao re-tentar indefinidamente (so se tiver url)
        if (!cache.reviewsUrl) {
          skipped++
          results.push({ stop_id: stop.id, skipped: 'no_google_reviews_url' })
        } else {
          skipped++
          results.push({ stop_id: stop.id, skipped: 'no_entregue_reparado_status' })
        }
        continue
      }

      // Valida que OS esta em Entregue Reparado (cliente aceitou o conserto)
      if (!stop.os_id) {
        skipped++
        results.push({ stop_id: stop.id, skipped: 'no_os' })
        continue
      }
      const os = await prisma.serviceOrder.findFirst({
        where: { id: stop.os_id, company_id: stop.company_id, deleted_at: null },
        select: {
          status_id: true, os_number: true, customer_id: true,
          customers: { select: { legal_name: true, mobile: true, phone: true } },
        },
      })
      if (!os || os.status_id !== cache.entregueReparadoId) {
        // OS nao aprovada — NAO envia e NAO marca. Se status mudar, proxima
        // execucao ainda pode enviar (ate 48h).
        skipped++
        results.push({ stop_id: stop.id, skipped: 'os_not_entregue_reparado' })
        continue
      }

      const rawPhone = (os.customers?.mobile || os.customers?.phone || stop.customer_phone || '').replace(/\D/g, '')
      if (!rawPhone || rawPhone.length < 10) {
        // Sem telefone — marca pra nao re-tentar
        await prisma.logisticsStop.update({
          where: { id: stop.id },
          data: { reviews_sent_at: new Date() },
        })
        skipped++
        results.push({ stop_id: stop.id, skipped: 'no_phone' })
        continue
      }
      const normalizedPhone = rawPhone.startsWith('55') ? rawPhone : `55${rawPhone}`
      const customerName = os.customers?.legal_name || stop.customer_name || 'Cliente'
      const firstName = customerName.split(' ')[0]

      // customer_id pra gerar o token do cupom — ja veio no select de os.
      const customerId: string | null = os.customer_id || null

      // Token do cupom vai como PARAMETRO DO BOTAO URL (nao no body).
      // Template v2 tem botao https://portal.pontualtech.com.br/cupom-avaliacao/{{1}}.
      const token = customerId
        ? buildCouponToken(stop.company_id, customerId)
        : 'sem-token'

      const link = `${getBaseUrl(stop.company_id)}/avaliar/${token}`
      const freeText = `Ola, ${firstName}! Gostariamos muito de ouvir sua opiniao sobre o atendimento. Toque no link para deixar seu feedback:\n\n${link}`

      // Estrategia: FREE TEXT primeiro (chega direto se janela 24h aberta).
      // Fallback = pt_feedback_v1 (categoria MARKETING — permite oferta
      // de desconto; templates UTILITY eram filtrados).
      let r = await sendWhatsAppCloud(stop.company_id, normalizedPhone, freeText)

      if (!r.success) {
        r = await sendWhatsAppTemplate(
          stop.company_id, normalizedPhone, 'pt_feedback_v1', 'pt_BR',
          [
            { type: 'body', parameters: [{ type: 'text', text: firstName }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
          ],
          freeText,
        )
      }
      if (!r.success) {
        // Ultimo fallback: v3 UTILITY (se aprovar um dia)
        r = await sendWhatsAppTemplate(
          stop.company_id, normalizedPhone, 'pt_avaliacao_google_v3', 'pt_BR',
          [
            { type: 'body', parameters: [{ type: 'text', text: firstName }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
          ],
          freeText,
        )
      }
      // E-mail de avaliacao em PARALELO (fire-and-forget) — independente
      // do resultado do WhatsApp. Multi-canal: WA + Email cobre os dois
      // canais mais comuns.
      const customerEmail = await (async () => {
        if (!stop.os_id) return null
        const oo = await prisma.serviceOrder.findUnique({
          where: { id: stop.os_id },
          select: { customers: { select: { email: true } } },
        })
        return oo?.customers?.email || null
      })()
      if (customerEmail) {
        void (async () => {
          try {
            const company = await prisma.company.findUnique({
              where: { id: stop.company_id },
              select: { name: true },
            })
            const tpl = await getFeedbackEmail(stop.company_id, {
              cliente: customerName,
              empresa: company?.name || 'PontualTech',
              os_number: os.os_number,
              link,
            })
            await sendCompanyEmail(stop.company_id, customerEmail, tpl.subject, tpl.html)
          } catch (err) {
            console.warn('[reviews] email falhou:', err instanceof Error ? err.message : String(err))
          }
        })()
      }

      if (r.success) {
        await prisma.logisticsStop.update({
          where: { id: stop.id },
          data: { reviews_sent_at: new Date() },
        })
        sent++
        results.push({ stop_id: stop.id, sent: true, os_number: os.os_number })
      } else {
        // Falhou — NAO marca, tenta de novo no proximo tick ate 48h
        skipped++
        results.push({ stop_id: stop.id, skipped: 'wa_failed', error: r.error })
      }
    } catch (err: any) {
      skipped++
      results.push({ stop_id: stop.id, skipped: 'exception', error: String(err?.message || err) })
    }
  }

  return NextResponse.json({
    data: { processed: stops.length, sent, skipped, details: results.slice(0, 20) },
  })
}
