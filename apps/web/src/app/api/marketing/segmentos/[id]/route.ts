import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { z } from 'zod'

const filtersSchema = z.object({
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  segment: z.enum(['b2c', 'b2b']).optional(),
  stage: z.string().optional(),
  unsubscribed: z.enum(['true', 'false']).optional(),
  onlyBounced: z.boolean().optional(),
}).strict()

const updateSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  description: z.string().max(500).nullable().optional(),
  filters: filtersSchema.optional(),
}).strict()

function ensureAdmin(user: { isSuperAdmin: boolean; roleName: string }) {
  if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }
  return null
}

// Calcula contact_count baseado nos filtros do segmento.
// Espelha lógica do GET /api/marketing/contatos.
async function countContacts(companyId: string, filters: any): Promise<number> {
  const where: any = { company_id: companyId }
  const f = filters || {}
  if (f.search) {
    where.OR = [
      { email: { contains: f.search, mode: 'insensitive' } },
      { name: { contains: f.search, mode: 'insensitive' } },
      { phone: { contains: f.search } },
    ]
  }
  const tags: string[] = Array.isArray(f.tags) ? [...f.tags] : []
  if (f.segment) tags.push(`segment:${f.segment}`)
  if (f.stage) tags.push(`stage:${f.stage}`)
  if (tags.length > 0) where.tags = { hasEvery: tags }
  if (f.unsubscribed === 'true') where.unsubscribed = true
  if (f.unsubscribed === 'false') where.unsubscribed = false
  if (f.onlyBounced) where.bounce_count = { gt: 0 }
  return prisma.marketingContact.count({ where })
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const segment = await prisma.marketingSegment.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!segment) return error('Segmento não encontrado', 404)

    // Recalcula count em runtime + atualiza cache. Evita count stale.
    const fresh = await countContacts(user.companyId, segment.filters as any)
    if (fresh !== segment.contact_count) {
      await prisma.marketingSegment.update({
        where: { id: segment.id },
        data: { contact_count: fresh, contact_count_updated_at: new Date() },
      })
    }

    return success({
      segment: { ...segment, contact_count: fresh, contact_count_updated_at: new Date() },
    })
  } catch (e) {
    return handleError(e)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const body = updateSchema.parse(await req.json())
    if (Object.keys(body).length === 0) return error('Nada para atualizar', 400)

    const existing = await prisma.marketingSegment.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Segmento não encontrado', 404)

    const updated = await prisma.marketingSegment.update({
      where: { id: params.id },
      data: {
        name: body.name ?? existing.name,
        description: body.description !== undefined ? body.description : existing.description,
        filters: body.filters ? (body.filters as any) : (existing.filters as any),
        // Se filtros mudaram, invalida cache de count
        ...(body.filters
          ? { contact_count: null, contact_count_updated_at: null }
          : {}),
      },
    })

    return success({ segment: updated })
  } catch (e: any) {
    if (e?.code === 'P2002') return error('Já existe um segmento com este nome.', 409)
    return handleError(e)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const existing = await prisma.marketingSegment.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Segmento não encontrado', 404)

    await prisma.marketingSegment.delete({ where: { id: params.id } })
    return success({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
