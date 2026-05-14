import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { z } from 'zod'

// Schema dos filtros suportados (espelha query params do GET /api/marketing/contatos)
const filtersSchema = z.object({
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  segment: z.enum(['b2c', 'b2b']).optional(),
  stage: z.string().optional(),
  unsubscribed: z.enum(['true', 'false']).optional(),
  onlyBounced: z.boolean().optional(),
}).strict()

const createSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(500).optional(),
  filters: filtersSchema,
})

function ensureAdmin(user: { isSuperAdmin: boolean; roleName: string }) {
  if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }
  return null
}

export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const segments = await prisma.marketingSegment.findMany({
      where: { company_id: user.companyId },
      orderBy: { created_at: 'desc' },
    })

    return success({ segments, total: segments.length })
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const body = createSchema.parse(await req.json())

    const segment = await prisma.marketingSegment.create({
      data: {
        company_id: user.companyId,
        name: body.name,
        description: body.description,
        filters: body.filters as any,
        created_by: user.id,
      },
    })

    return success({ segment }, 201)
  } catch (e: any) {
    if (e?.code === 'P2002') return error('Já existe um segmento com este nome.', 409)
    return handleError(e)
  }
}
