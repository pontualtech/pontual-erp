import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'
import { findStatusByName } from '@/lib/module-status'

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
const WINDOW_MIN_MS = 10 * 60 * 1000       // >= 10min depois de entregar
const WINDOW_MAX_MS = 48 * 60 * 60 * 1000  // < 48h (stops antigos sao ignorados)

export async function POST(req: NextRequest) {
  const internalKey = req.headers.get('x-internal-key')
  const validKeys = [
    process.env.INTERNAL_API_KEY,
    process.env.CRON_SECRET,
    process.env.BOT_WEBHOOK_SECRET,
  ].filter(Boolean)
  if (!internalKey || !validKeys.includes(internalKey)) {
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
        const entregueStatus = await findStatusByName(
          stop.company_id, 'os', 'Entregue Reparado', 'Entregar Reparado', 'Entregue',
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
        where: { id: stop.os_id, company_id: stop.company_id },
        select: {
          status_id: true, os_number: true,
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
      const fallback = `Ola, ${firstName}! Esperamos que tenha gostado do nosso atendimento. Que tal deixar uma avaliacao rapida no Google? Leva menos de 1 minuto: ${cache.reviewsUrl}`

      const r = await sendWhatsAppTemplate(
        stop.company_id, normalizedPhone, 'pt_avaliacao_google_v1', 'pt_BR',
        [{
          type: 'body',
          parameters: [
            { type: 'text', text: firstName },
            { type: 'text', text: cache.reviewsUrl },
          ],
        }],
        fallback,
      )
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
