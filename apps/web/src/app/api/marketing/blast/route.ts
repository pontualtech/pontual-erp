import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import { enqueueJobs, isQueueAvailable } from '@/lib/email-queue'

/**
 * GET  /api/marketing/blast — lista campanhas (filtro por status opcional)
 * POST /api/marketing/blast — cria campanha + cria EmailJobs + enfileira
 *
 * Permission: marketing.manage (admin/manager). View only nao consegue.
 */

interface CreateBlastBody {
  slug: string
  template_name: string
  subject: string
  from_email?: string
  reply_to?: string
  /** Filtros: por tags OU lista explicita de IDs. Se ambos vazios = TODOS marketing_contacts da company nao-unsubscribed */
  contact_tags?: string[]
  contact_ids?: string[]
  rate_limit_per_sec?: number
  config_json?: Record<string, unknown>
  /** Se true: cria campaign + jobs mas NAO enfileira no BullMQ. Pra preview. */
  dry_run?: boolean
}

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('marketing', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)

    const campaigns = await prisma.emailCampaign.findMany({
      where: {
        company_id: user.companyId,
        ...(status ? { status } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    })

    return success({ campaigns, queue_available: isQueueAvailable() })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
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

    const body = (await req.json().catch(() => ({}))) as Partial<CreateBlastBody>
    if (!body.slug || !body.template_name || !body.subject) {
      return NextResponse.json(
        { error: 'slug, template_name, subject obrigatorios' },
        { status: 400 },
      )
    }

    // Slug unico por company — evita duplicar campanha por engano
    const existing = await prisma.emailCampaign.findFirst({
      where: { company_id: user.companyId, slug: body.slug },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'slug_already_exists', campaign_id: existing.id },
        { status: 409 },
      )
    }

    // Filtra contatos. unsubscribed sempre excluido.
    const where: any = {
      company_id: user.companyId,
      unsubscribed: false,
    }
    if (body.contact_ids && body.contact_ids.length > 0) {
      where.id = { in: body.contact_ids }
    } else if (body.contact_tags && body.contact_tags.length > 0) {
      where.tags = { hasSome: body.contact_tags }
    }

    const contacts = await prisma.marketingContact.findMany({
      where,
      select: { id: true, email: true },
      take: 50_000,  // hard cap defensivo
    })

    if (contacts.length === 0) {
      return NextResponse.json(
        { error: 'no_contacts_matched' },
        { status: 400 },
      )
    }

    // Transaction: cria campaign + N EmailJob de uma vez
    const campaign = await prisma.$transaction(async (tx) => {
      const c = await tx.emailCampaign.create({
        data: {
          company_id: user.companyId,
          slug: body.slug!,
          template_name: body.template_name!,
          subject: body.subject!,
          from_email: body.from_email || 'PontualTech <newsletter@pontualtech.com.br>',
          reply_to: body.reply_to || 'contato@pontualtech.com.br',
          status: body.dry_run ? 'queued' : 'running',
          total_jobs: contacts.length,
          rate_limit_per_sec: body.rate_limit_per_sec ?? 1.0,
          config_json: (body.config_json as any) || {},
          started_at: body.dry_run ? null : new Date(),
          created_by: user.id,
        },
      })
      await tx.emailJob.createMany({
        data: contacts.map(ct => ({
          campaign_id: c.id,
          contact_id: ct.id,
        })),
        skipBatchSize: 1000 as any,
      } as any)
      return c
    })

    if (body.dry_run) {
      return success({
        ok: true,
        campaign_id: campaign.id,
        total_jobs: contacts.length,
        dry_run: true,
        note: 'Jobs criados mas NAO enfileirados. POST /api/marketing/blast/[id]/start pra disparar.',
      })
    }

    // Enfileira no BullMQ
    const jobs = await prisma.emailJob.findMany({
      where: { campaign_id: campaign.id },
      select: { id: true },
    })
    const { enqueued, failed } = await enqueueJobs(campaign.id, jobs.map(j => j.id))

    // Atualiza queued_at + status nos jobs enfileirados
    if (enqueued > 0) {
      await prisma.emailJob.updateMany({
        where: { campaign_id: campaign.id, status: 'pending' },
        data: { status: 'queued', queued_at: new Date() },
      })
    }

    return success({
      ok: true,
      campaign_id: campaign.id,
      total_jobs: contacts.length,
      enqueued,
      enqueue_failed: failed.length,
      estimated_eta_min: Math.ceil(contacts.length / (body.rate_limit_per_sec ?? 1.0) / 60),
    })
  } catch (err) {
    return handleError(err)
  }
}
