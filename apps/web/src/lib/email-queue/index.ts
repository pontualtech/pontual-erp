/**
 * Email-Queue public API.
 *
 * Worker e startado em instrumentation.ts:
 *   import { startEmailWorker } from '@/lib/email-queue'
 *   startEmailWorker()
 *
 * APIs (/api/marketing/blast/*) usam enqueueJobs() + cancelCampaignJobs().
 */

export { isQueueAvailable } from './redis'
export { getEmailQueue, enqueueJobs, cancelCampaignJobs } from './queue'
export { startEmailWorker, stopEmailWorker } from './worker'
export { sendBlastEmail, personalizeHtml } from './sender'
export { EMAIL_QUEUE_NAME } from './types'
export type { EmailJobData, SendResult, CampaignStatus, JobStatus } from './types'
