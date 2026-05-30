/**
 * BullMQ Queue (publisher). Singleton lazy.
 *
 * Enfileira jobs com retries 3x + backoff exponencial. Quando o worker
 * processa, lê o EmailJob do DB pelo jobId pra pegar dados frescos
 * (evita stale snapshot no payload BullMQ).
 */
import { Queue, type ConnectionOptions } from 'bullmq'
import { prisma } from '@pontual/db'
import { EMAIL_QUEUE_NAME, type EmailJobData } from './types'

function getConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('REDIS_URL nao configurado — fila de email indisponivel')
  return { url, maxRetriesPerRequest: null }
}

let _queue: Queue<EmailJobData> | null = null

export function getEmailQueue(): Queue<EmailJobData> {
  if (_queue) return _queue
  const q = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },  // 30s, 60s, 120s
      removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },  // 7d ou 10k
      removeOnFail: { age: 30 * 24 * 3600 },  // mantém 30d pra debug
    },
  })
  _queue = q
  return q
}

/**
 * Enfileira N EmailJob ids de uma campanha. Marca cada um como 'queued'
 * no DB e salva o BullMQ job id pra rastreamento.
 *
 * IMPORTANTE: chamar dentro de transaction Prisma — se BullMQ falhar
 * no meio, rollback do DB evita state inconsistente.
 */
export async function enqueueJobs(
  campaignId: string,
  jobIds: string[],
): Promise<{ enqueued: number; failed: string[] }> {
  const queue = getEmailQueue()
  const failed: string[] = []

  // BullMQ addBulk — atomic na fila, melhor que add() em loop
  const bullData = jobIds.map(jobId => ({
    name: 'send',
    data: { campaignId, jobId } satisfies EmailJobData,
    opts: { jobId: `${campaignId}:${jobId}` },  // dedup natural
  }))

  try {
    await queue.addBulk(bullData)
    // Audit #13 (2026-05-29): backfill bullmq_job_id no DB pra observabilidade
    // BullMQ job id e deterministico (campaignId:jobId), 1 raw query pros N jobs.
    // Best-effort: se falha no DB, addBulk ja foi — nao reverter o enqueue.
    try {
      await prisma.$executeRaw`
        UPDATE email_jobs
        SET bullmq_job_id = ${campaignId} || ':' || id
        WHERE campaign_id = ${campaignId}
          AND id = ANY(${jobIds}::text[])
          AND bullmq_job_id IS NULL
      `
    } catch (dbErr) {
      console.warn('[email-queue/enqueueJobs] bullmq_job_id backfill failed (non-fatal):', dbErr instanceof Error ? dbErr.message : dbErr)
    }
    return { enqueued: jobIds.length, failed: [] }
  } catch (err) {
    console.error('[email-queue/enqueueJobs] bulk add failed:', err)
    return { enqueued: 0, failed: jobIds }
  }
}

/**
 * Cancela jobs pending/queued de uma campanha. Jobs ATIVOS (em envio
 * pelo worker AGORA) NÃO são interrompidos — BullMQ não suporta nativamente
 * matar workers mid-job. O worker tem guard que detecta cancel e skipa o
 * próximo job, então o impacto é ~1-3 jobs depois do cancel ainda saírem.
 *
 * Audit #12 (2026-05-29): antes só removia do BullMQ, deixava DB com
 * EmailJob.status='queued' eternamente. Agora também marca DB consistente.
 */
export async function cancelCampaignJobs(campaignId: string): Promise<{ removed_from_queue: number; skipped_in_db: number }> {
  const queue = getEmailQueue()

  // 1) Remove jobs ainda não-active do BullMQ (waiting|delayed|paused)
  //    Active (sendo processado) BullMQ não permite remover — worker continua
  const waiting = await queue.getJobs(['waiting', 'delayed', 'paused'])
  const targets = waiting.filter(j => j.data?.campaignId === campaignId)
  await Promise.all(targets.map(j => j.remove().catch(() => null)))

  // 2) Atualiza DB pra estado consistente — todos jobs ainda não-enviados
  //    viram 'skipped' com motivo. Idempotente: jobs já 'sent'/'failed'/'skipped' não mudam.
  const updated = await prisma.emailJob.updateMany({
    where: {
      campaign_id: campaignId,
      status: { in: ['pending', 'queued'] },
    },
    data: {
      status: 'skipped',
      last_error: 'campaign_cancelled',
    },
  })

  return { removed_from_queue: targets.length, skipped_in_db: updated.count }
}
