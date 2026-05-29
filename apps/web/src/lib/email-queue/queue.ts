/**
 * BullMQ Queue (publisher). Singleton lazy.
 *
 * Enfileira jobs com retries 3x + backoff exponencial. Quando o worker
 * processa, lê o EmailJob do DB pelo jobId pra pegar dados frescos
 * (evita stale snapshot no payload BullMQ).
 */
import { Queue, type ConnectionOptions } from 'bullmq'
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
    return { enqueued: jobIds.length, failed: [] }
  } catch (err) {
    console.error('[email-queue/enqueueJobs] bulk add failed:', err)
    return { enqueued: 0, failed: jobIds }
  }
}

/**
 * Remove jobs pending/active de uma campanha (cancel).
 * Jobs já sendo processados terminam — não interrompe meio do envio.
 */
export async function cancelCampaignJobs(campaignId: string): Promise<{ removed: number }> {
  const queue = getEmailQueue()
  // Filtra job ids que começam com `${campaignId}:`
  const waiting = await queue.getJobs(['waiting', 'delayed', 'paused'])
  const targets = waiting.filter(j => j.data?.campaignId === campaignId)
  await Promise.all(targets.map(j => j.remove().catch(() => null)))
  return { removed: targets.length }
}
