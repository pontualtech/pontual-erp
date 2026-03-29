import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateApiKey, checkApiPermission, type ApiKeyUser } from '@/lib/api-key-auth'
import { updateCustomerSchema } from '@/lib/validations/clientes'
import { ZodError } from 'zod'

type Params = { params: { id: string } }

/**
 * GET /api/v1/clientes/[id] — Detalhe do cliente
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authenticateApiKey(req)
    if (authResult instanceof NextResponse) return authResult
    const user = authResult as ApiKeyUser

    const permError = checkApiPermission(user, 'clientes:read')
    if (permError) return permError

    const customer = await prisma.customer.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        service_orders: {
          where: { deleted_at: null },
          orderBy: { created_at: 'desc' },
          take: 10,
        },
      },
    })

    if (!customer) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })
    }

    return NextResponse.json({ data: customer })
  } catch (err) {
    console.error('[API v1 Clientes GET id]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

/**
 * PUT /api/v1/clientes/[id] — Atualizar cliente
 */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authenticateApiKey(req)
    if (authResult instanceof NextResponse) return authResult
    const user = authResult as ApiKeyUser

    const permError = checkApiPermission(user, 'clientes:write')
    if (permError) return permError

    const existing = await prisma.customer.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = updateCustomerSchema.parse(body)

    const customer = await prisma.customer.update({
      where: { id: params.id },
      data: validatedData as any,
    })

    return NextResponse.json({ data: customer })
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Dados inválidos', details: err.errors }, { status: 422 })
    }
    console.error('[API v1 Clientes PUT]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
