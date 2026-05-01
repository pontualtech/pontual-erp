import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { success, handleError, error as apiError } from '@/lib/api-response'

const upsertSchema = z.object({
  company_id: z.string().min(1),
  enabled: z.boolean(),
})

const removeSchema = z.object({
  company_id: z.string().min(1),
})

// PUT /api/admin/feature-flags/[key]/overrides — set tenant override (upsert)
export async function PUT(request: NextRequest, ctx: { params: { key: string } }) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const body = upsertSchema.parse(await request.json())

    const flag = await prisma.featureFlag.findUnique({ where: { key: ctx.params.key } })
    if (!flag) return apiError('Flag não encontrada', 404)

    const company = await prisma.company.findUnique({ where: { id: body.company_id } })
    if (!company) return apiError('Empresa não encontrada', 404)

    await prisma.tenantFeatureFlag.upsert({
      where: { flag_key_company_id: { flag_key: ctx.params.key, company_id: body.company_id } },
      create: {
        flag_key: ctx.params.key,
        company_id: body.company_id,
        enabled: body.enabled,
      },
      update: { enabled: body.enabled },
    })

    return success({ ok: true })
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/admin/feature-flags/[key]/overrides — remove tenant override
export async function DELETE(request: NextRequest, ctx: { params: { key: string } }) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const body = removeSchema.parse(await request.json())

    await prisma.tenantFeatureFlag.deleteMany({
      where: { flag_key: ctx.params.key, company_id: body.company_id },
    })

    return success({ ok: true })
  } catch (err) {
    return handleError(err)
  }
}
