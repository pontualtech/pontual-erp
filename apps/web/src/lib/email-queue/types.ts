/**
 * Tipos compartilhados entre queue, worker e API.
 *
 * EmailJobData e o payload que vai pro BullMQ — minimo (so IDs). O worker
 * carrega os dados completos do DB quando processa, garantindo source-of-truth.
 */

export interface EmailJobData {
  /** ID da EmailCampaign no DB */
  campaignId: string
  /** ID do EmailJob (1 row por contato+campanha) */
  jobId: string
}

export interface SendResult {
  ok: boolean
  resend_id?: string
  error?: string
}

export type CampaignStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'
export type JobStatus = 'pending' | 'queued' | 'sent' | 'failed' | 'skipped'

export const EMAIL_QUEUE_NAME = 'email-blast'
