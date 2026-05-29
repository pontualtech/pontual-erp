/**
 * BullMQ Worker — consome jobs da fila email-blast.
 *
 * Concurrency=1 + rate limit no Worker garante envio serial controlado.
 * Rate efetivo final = MIN(Worker.limiter, campaign.rate_limit_per_sec).
 *
 * Worker e singleton, startado em instrumentation.ts no boot do Next.js.
 * Reconnect a Redis e automatico (BullMQ gerencia).
 */
import { Worker, type Job, type ConnectionOptions } from 'bullmq'
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@pontual/db'
import { EMAIL_QUEUE_NAME, type EmailJobData, type SendResult } from './types'
import { sendBlastEmail, personalizeHtml } from './sender'

function getWorkerConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL!
  return { url, maxRetriesPerRequest: null }
}

let _worker: Worker<EmailJobData> | null = null

// Cache de HTML templates (path-based, 30min TTL — invalida em redeploy)
const templateCache = new Map<string, { html: string; expires: number }>()
const TEMPLATE_CACHE_TTL = 30 * 60 * 1000

async function loadTemplate(templateName: string): Promise<string> {
  const cached = templateCache.get(templateName)
  if (cached && cached.expires > Date.now()) return cached.html

  // 2 paths: standalone bundle (__dirname) + dev cwd-based
  const candidates = [
    path.join(__dirname, '../../lib/nurture/templates', templateName),
    path.join(process.cwd(), 'src/lib/nurture/templates', templateName),
    path.join(process.cwd(), 'apps/web/src/lib/nurture/templates', templateName),
  ]
  for (const p of candidates) {
    try {
      const html = await fs.readFile(p, 'utf-8')
      templateCache.set(templateName, { html, expires: Date.now() + TEMPLATE_CACHE_TTL })
      return html
    } catch {
      continue
    }
  }
  throw new Error(`Template nao encontrado: ${templateName}`)
}

/**
 * Fecha campanha quando todos os jobs (sent+failed+skipped) >= total_jobs.
 * SQL atomico + WHERE status='running' = idempotent + race-safe.
 * Chamar apos qualquer mudanca de contador (sent/failed/skipped).
 */
async function maybeCompleteCampaign(campaignId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE email_campaigns
    SET status = 'completed', finished_at = NOW()
    WHERE id = ${campaignId}
      AND status = 'running'
      AND (sent_count + failed_count + skipped_count) >= total_jobs
  `
}

async function processJob(job: Job<EmailJobData>): Promise<SendResult> {
  const { jobId, campaignId } = job.data

  // Source-of-truth e o DB — payload BullMQ pode estar stale (cancelamento, retry)
  const emailJob = await prisma.emailJob.findUnique({
    where: { id: jobId },
    include: { campaign: true, contact: true },
  })
  if (!emailJob) throw new Error(`EmailJob ${jobId} not found`)
  if (emailJob.status === 'sent' || emailJob.status === 'skipped') {
    return { ok: true }  // ja processado (retry duplicado, idempotent)
  }

  const campaign = emailJob.campaign
  if (campaign.status === 'cancelled' || campaign.status === 'completed') {
    await prisma.emailJob.update({
      where: { id: jobId },
      data: { status: 'skipped', last_error: `campaign_${campaign.status}` },
    })
    return { ok: true }
  }

  const contact = emailJob.contact
  if (contact.unsubscribed) {
    await prisma.emailJob.update({
      where: { id: jobId },
      data: { status: 'skipped', last_error: 'contact_unsubscribed' },
    })
    await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: { skipped_count: { increment: 1 } },
    })
    await maybeCompleteCampaign(campaignId)
    return { ok: true }
  }

  // Marca attempt + carrega template
  await prisma.emailJob.update({
    where: { id: jobId },
    data: { attempts: { increment: 1 } },
  })

  let html: string
  try {
    html = await loadTemplate(campaign.template_name)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'template_load_error'
    await prisma.emailJob.update({
      where: { id: jobId },
      data: { status: 'failed', last_error: msg.slice(0, 500), failed_at: new Date() },
    })
    await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: { failed_count: { increment: 1 } },
    })
    await maybeCompleteCampaign(campaignId)
    return { ok: false, error: msg }
  }

  const cfg = (campaign.config_json as any) || {}
  const personalized = personalizeHtml(html, contact, {
    utmCampaign: campaign.slug,
    webviewUrl: cfg.webview_url,
    waUrl: cfg.wa_url,
  })

  const result = await sendBlastEmail({
    companyId: campaign.company_id,
    to: contact.email,
    subject: campaign.subject,
    html: personalized,
    fromEmail: campaign.from_email,
    replyTo: campaign.reply_to,
  })

  if (result.ok) {
    await prisma.$transaction([
      prisma.emailJob.update({
        where: { id: jobId },
        data: { status: 'sent', sent_at: new Date(), resend_id: result.resend_id || null, last_error: null },
      }),
      prisma.emailCampaign.update({
        where: { id: campaignId },
        data: { sent_count: { increment: 1 } },
      }),
      prisma.marketingContact.update({
        where: { id: contact.id },
        data: { last_sent_at: new Date() },
      }),
    ])
    // 2026-05-29 audit fix: fecha campanha quando ultimo job termina (sent path)
    await maybeCompleteCampaign(campaignId)
    // Throttle por campanha — sleep depois de cada envio bem sucedido
    const sleepMs = Math.max(50, Math.floor(1000 / campaign.rate_limit_per_sec))
    await new Promise(r => setTimeout(r, sleepMs))
    return result
  }

  // Falha: throw pra BullMQ retentar (3x conforme defaultJobOptions)
  await prisma.emailJob.update({
    where: { id: jobId },
    data: { last_error: (result.error || 'send_failed').slice(0, 500) },
  })
  throw new Error(result.error || 'send_failed')
}

export function startEmailWorker(): Worker<EmailJobData> | null {
  if (_worker) return _worker
  if (!process.env.REDIS_URL) {
    console.warn('[email-queue/worker] REDIS_URL ausente — worker NAO iniciado')
    return null
  }

  _worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    processJob,
    {
      connection: getWorkerConnection(),
      concurrency: 1,  // serial — throttle interno controla rate
      limiter: { max: 10, duration: 1000 },  // cap global: 10/seg (anti Resend 429)
    },
  )

  _worker.on('completed', (job) => {
    console.log(`[email-queue] sent ${job.data.jobId} (campaign ${job.data.campaignId})`)
  })
  _worker.on('failed', async (job, err) => {
    if (!job) return
    console.error(`[email-queue] failed ${job.data.jobId}:`, err.message)
    // Final attempt? marca como failed no DB
    if (job.attemptsMade >= (job.opts.attempts || 3)) {
      try {
        await prisma.emailJob.update({
          where: { id: job.data.jobId },
          data: { status: 'failed', failed_at: new Date(), last_error: err.message.slice(0, 500) },
        })
        await prisma.emailCampaign.update({
          where: { id: job.data.campaignId },
          data: { failed_count: { increment: 1 } },
        })
        await maybeCompleteCampaign(job.data.campaignId)
      } catch {}
    }
  })

  console.log('[email-queue/worker] started')
  return _worker
}

export async function stopEmailWorker(): Promise<void> {
  if (_worker) {
    await _worker.close()
    _worker = null
  }
}
