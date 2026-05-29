import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { invalidateImprimitechHandoffCache, isImprimitechHandoffStatus } from '@/lib/imprimitech-handoff'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const module = req.nextUrl.searchParams.get('module') || 'os'

    const statuses = await prisma.moduleStatus.findMany({
      where: { company_id: user.companyId, module },
      orderBy: { order: 'asc' },
    })

    return success(statuses)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    if (!body.name) return error('Nome é obrigatório', 400)

    const status = await prisma.moduleStatus.create({
      data: {
        company_id: user.companyId,
        module: body.module || 'os',
        name: body.name,
        color: body.color || '#6B7280',
        order: body.order ?? 0,
        is_default: body.is_default ?? false,
        is_final: body.is_final ?? false,
      },
    })

    // Wave 1.2 audit R1: se o novo status é "Imprimitech", invalida cache
    // negativo (5min) — handoff helper vai re-resolver o novo id imediatamente.
    if (isImprimitechHandoffStatus(status.name)) {
      invalidateImprimitechHandoffCache(user.companyId)
    }

    return success(status, 201)
  } catch (err) {
    return handleError(err)
  }
}
