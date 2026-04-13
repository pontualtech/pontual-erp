import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateApiKey, checkApiPermission, type ApiKeyUser } from '@/lib/api-key-auth'
import { updateOSSchema } from '@/lib/validations/os'
import { ZodError } from 'zod'

type Params = { params: { id: string } }

/**
 * GET /api/v1/os/[id] — Detalhe da OS
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authenticateApiKey(req)
    if (authResult instanceof NextResponse) return authResult
    const user = authResult as ApiKeyUser

    const permError = checkApiPermission(user, 'os:read')
    if (permError) return permError

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        customers: true,
        user_profiles: { select: { id: true, name: true } },
        service_order_items: { where: { deleted_at: null }, orderBy: { created_at: 'asc' } },
        service_order_photos: { orderBy: { created_at: 'asc' } },
      },
    })

    if (!os) {
      return NextResponse.json({ error: 'OS não encontrada' }, { status: 404 })
    }

    return NextResponse.json({ data: os })
  } catch (err) {
    console.error('[API v1 OS GET id]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

/**
 * PUT /api/v1/os/[id] — Atualizar OS
 */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authenticateApiKey(req)
    if (authResult instanceof NextResponse) return authResult
    const user = authResult as ApiKeyUser

    const permError = checkApiPermission(user, 'os:write')
    if (permError) return permError

    const existing = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) {
      return NextResponse.json({ error: 'OS não encontrada' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = updateOSSchema.parse(body)

    const os = await prisma.serviceOrder.update({
      where: { id: params.id, company_id: user.companyId },
      data: validatedData as any,
      include: { customers: true },
    })

    return NextResponse.json({ data: os })
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Dados inválidos', details: err.errors }, { status: 422 })
    }
    console.error('[API v1 OS PUT]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
