import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { success, handleError, error as apiError } from '@/lib/api-response'

const updateSchema = z.object({
  description: z.string().max(500).nullable().optional(),
  strategy: z.enum(['OFF', 'ON', 'PERCENTAGE', 'TENANT_LIST']).optional(),
  rollout_pct: z.number().int().min(0).max(100).optional(),
})

export async function PATCH(request: NextRequest, ctx: { params: { key: string } }) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const body = updateSchema.parse(await request.json())

    const exists = await prisma.featureFlag.findUnique({ where: { key: ctx.params.key } })
    if (!exists) return apiError('Flag não encontrada', 404)

    await prisma.featureFlag.update({
      where: { key: ctx.params.key },
      data: body,
    })

    return success({ ok: true })
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_request: NextRequest, ctx: { params: { key: string } }) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const exists = await prisma.featureFlag.findUnique({ where: { key: ctx.params.key } })
    if (!exists) return apiError('Flag não encontrada', 404)

    // CASCADE em tenant_overrides via Prisma onDelete: Cascade
    await prisma.featureFlag.delete({ where: { key: ctx.params.key } })

    return success({ ok: true })
  } catch (err) {
    return handleError(err)
  }
}
