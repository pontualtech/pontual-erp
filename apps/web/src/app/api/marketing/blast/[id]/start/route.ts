import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import { enqueueJobs, isQueueAvailable } from '@/lib/email-queue'

/**
 * POST /api/marketing/blast/[id]/start
 *
 * Enfileira uma campanha que ja foi criada com dry_run=true. Usa-se assim:
 *   POST /api/marketing/blast  body: { dry_run: true, ... } → cria campaign + jobs
 *   GET  /api/marketing/blast/[id] → operador revisa stats / sample
 *   POST /api/marketing/blast/[id]/start → dispara
 *
 * Idempotente: re-chamar com campanha ja running so re-enfileira jobs pendentes
 * (uteis pra resgatar campanhas onde enqueueJobs falhou parcialmente).
 *
 * Audit 2026-05-29: criado pra fechar bug #4 do audit profundo.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('marketing', 'manage')
    if (result instanceof NextResponse) return result
    const user = result

    if (!isQueueAvailable()) {
      return NextResponse.json(
        { error: 'queue_unavailable', detail: 'REDIS_URL nao configurado' },
        { status: 503 },
      )
    }

    const campaign = await prisma.emailCampaign.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!campaign) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    if (campaign.status === 'cancelled' || campaign.status === 'completed') {
      return NextResponse.json(
        { error: 'cannot_start', detail: `campanha ja esta ${campaign.status}` },
        { status: 409 },
      )
    }

    if (campaign.status === 'failed') {
      return NextResponse.json(
        { error: 'cannot_start', detail: 'campanha esta failed; cancele e crie uma nova' },
        { status: 409 },
      )
    }

    // Pega jobs pending — idempotente, jobs ja queued sao ignorados
    const jobs = await prisma.emailJob.findMany({
      where: { campaign_id: campaign.id, status: 'pending' },
      select: { id: true },
    })

    if (jobs.length === 0) {
      // Sem jobs pending — talvez todos ja queued ou enviados; so atualiza status se necessario
      if (campaign.status === 'queued') {
        await prisma.emailCampaign.update({
          where: { id: campaign.id },
          data: { status: 'running', started_at: new Date() },
        })
      }
      return success({ ok: true, enqueued: 0, message: 'nenhum job pending', campaign_status: 'running' })
    }

    const jobIds = jobs.map(j => j.id)
    const { enqueued, failed } = await enqueueJobs(campaign.id, jobIds)

    if (enqueued === 0 && failed.length > 0) {
      // Falha total — DB consistente, nao marca como queued
      return NextResponse.json(
        { error: 'enqueue_failed', detail: 'BullMQ falhou em enfileirar todos os jobs (Redis down?)' },
        { status: 503 },
      )
    }

    // Marca apenas os que entraram OK na fila
    if (enqueued > 0) {
      await prisma.$transaction([
        prisma.emailJob.updateMany({
          where: { campaign_id: campaign.id, status: 'pending' },
          data: { status: 'queued', queued_at: new Date() },
        }),
        prisma.emailCampaign.update({
          where: { id: campaign.id },
          data: {
            status: 'running',
            started_at: campaign.started_at || new Date(),
          },
        }),
      ])
    }

    return success({
      ok: true,
      campaign_id: campaign.id,
      enqueued,
      enqueue_failed: failed.length,
      campaign_status: 'running',
    })
  } catch (err) {
    return handleError(err)
  }
}
