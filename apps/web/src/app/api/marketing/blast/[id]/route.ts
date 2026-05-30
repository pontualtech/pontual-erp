import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import { cancelCampaignJobs } from '@/lib/email-queue'

/**
 * GET    /api/marketing/blast/[id] — detalhe + estatisticas em tempo real
 * POST   /api/marketing/blast/[id] (body {action: 'cancel'}) — cancela
 * DELETE /api/marketing/blast/[id] — alias pra cancel (cleaner pra UI)
 *
 * Cancel: marca status='cancelled' + remove jobs waiting/delayed da fila.
 * Jobs sendo processados terminam normalmente. Sem rollback de envios.
 */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('marketing', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const campaign = await prisma.emailCampaign.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!campaign) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    // Stats em tempo real (mais frescos que counters denormalizados)
    const statusBreakdown = await prisma.emailJob.groupBy({
      by: ['status'],
      where: { campaign_id: params.id },
      _count: { _all: true },
    })
    const stats = Object.fromEntries(
      statusBreakdown.map(s => [s.status, s._count._all]),
    )

    // Failed recentes pra debug
    const recentFailed = await prisma.emailJob.findMany({
      where: { campaign_id: params.id, status: 'failed' },
      orderBy: { failed_at: 'desc' },
      take: 10,
      include: { contact: { select: { email: true } } },
    })

    return success({
      campaign,
      stats: {
        pending: stats.pending || 0,
        queued: stats.queued || 0,
        sent: stats.sent || 0,
        failed: stats.failed || 0,
        skipped: stats.skipped || 0,
      },
      progress_pct: campaign.total_jobs > 0
        ? Math.round(((stats.sent || 0) / campaign.total_jobs) * 100)
        : 0,
      recent_failed: recentFailed.map(f => ({
        email: f.contact.email,
        attempts: f.attempts,
        error: f.last_error,
        failed_at: f.failed_at,
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}

async function handleCancel(campaignId: string, userCompanyId: string) {
  const campaign = await prisma.emailCampaign.findFirst({
    where: { id: campaignId, company_id: userCompanyId },
  })
  if (!campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (campaign.status === 'completed' || campaign.status === 'cancelled') {
    return NextResponse.json(
      { error: 'cannot_cancel', detail: `campanha ja esta ${campaign.status}` },
      { status: 409 },
    )
  }

  const { removed_from_queue, skipped_in_db } = await cancelCampaignJobs(campaignId)
  await prisma.emailCampaign.update({
    where: { id: campaignId },
    data: { status: 'cancelled', cancelled_at: new Date() },
  })
  return success({ ok: true, removed_from_queue, skipped_in_db })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('marketing', 'manage')
    if (result instanceof NextResponse) return result
    const user = result

    const body = (await req.json().catch(() => ({}))) as { action?: string }
    if (body.action !== 'cancel') {
      return NextResponse.json(
        { error: 'invalid_action', detail: "use action: 'cancel'" },
        { status: 400 },
      )
    }
    return handleCancel(params.id, user.companyId)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('marketing', 'manage')
    if (result instanceof NextResponse) return result
    const user = result
    return handleCancel(params.id, user.companyId)
  } catch (err) {
    return handleError(err)
  }
}
