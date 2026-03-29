import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateApiKey, checkApiPermission, type ApiKeyUser } from '@/lib/api-key-auth'
import { createOSSchema } from '@/lib/validations/os'
import { ZodError } from 'zod'

/**
 * GET /api/v1/os — Listar ordens de serviço
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await authenticateApiKey(req)
    if (authResult instanceof NextResponse) return authResult
    const user = authResult as ApiKeyUser

    const permError = checkApiPermission(user, 'os:read')
    if (permError) return permError

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, Number(url.get('limit') || '20')))
    const search = url.get('search') || ''
    const statusId = url.get('status_id') || null
    const technicianId = url.get('technician_id') || null

    const where: any = {
      company_id: user.companyId,
      deleted_at: null,
    }

    if (statusId) where.status_id = statusId
    if (technicianId) where.technician_id = technicianId
    if (search) {
      where.OR = [
        { os_number: isNaN(Number(search)) ? undefined : Number(search) },
        { equipment_type: { contains: search, mode: 'insensitive' } },
        { reported_issue: { contains: search, mode: 'insensitive' } },
      ].filter(Boolean)
    }

    const [data, total] = await Promise.all([
      prisma.serviceOrder.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          customers: { select: { id: true, legal_name: true, phone: true } },
          user_profiles: { select: { id: true, name: true } },
        },
      }),
      prisma.serviceOrder.count({ where }),
    ])

    return NextResponse.json({ data, total, page, limit })
  } catch (err) {
    console.error('[API v1 OS GET]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

/**
 * POST /api/v1/os — Criar ordem de serviço
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateApiKey(req)
    if (authResult instanceof NextResponse) return authResult
    const user = authResult as ApiKeyUser

    const permError = checkApiPermission(user, 'os:write')
    if (permError) return permError

    const body = await req.json()
    const data = createOSSchema.parse(body)

    // Status inicial
    const initialStatus = await prisma.moduleStatus.findFirst({
      where: { company_id: user.companyId, module: 'os', is_default: true },
    })
    if (!initialStatus) {
      return NextResponse.json({ error: 'Status inicial não configurado' }, { status: 500 })
    }

    // Criar com número atômico
    const os = await prisma.$transaction(async (tx) => {
      const result = await tx.$queryRaw<{ next_number: number }[]>`
        SELECT COALESCE(MAX(os_number), 0) + 1 as next_number
        FROM service_orders
        WHERE company_id = ${user.companyId}
        FOR UPDATE
      `
      const nextNumber = result[0]?.next_number || 1

      const { estimated_delivery, ...rest } = data
      const created = await tx.serviceOrder.create({
        data: {
          ...rest,
          company_id: user.companyId,
          os_number: nextNumber,
          status_id: initialStatus.id,
          estimated_delivery: estimated_delivery ? new Date(estimated_delivery) : undefined,
        } as any,
        include: { customers: true },
      })

      await tx.serviceOrderHistory.create({
        data: {
          company_id: user.companyId,
          service_order_id: created.id,
          to_status_id: initialStatus.id,
          changed_by: `api:${user.apiKeyId}`,
          notes: 'OS criada via API v1',
        },
      })

      return created
    })

    return NextResponse.json({ data: os }, { status: 201 })
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Dados inválidos', details: err.errors }, { status: 422 })
    }
    console.error('[API v1 OS POST]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
