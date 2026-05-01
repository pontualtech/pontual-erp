import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

const createSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9_.-]+$/i, 'apenas letras, números, _, ., -'),
  description: z.string().max(500).nullable().optional(),
  strategy: z.enum(['OFF', 'ON', 'PERCENTAGE', 'TENANT_LIST']).default('OFF'),
  rollout_pct: z.number().int().min(0).max(100).default(0),
})

export async function GET(_request: NextRequest) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const flags = await prisma.featureFlag.findMany({
      include: {
        tenant_overrides: {
          select: { company_id: true, enabled: true, enabled_at: true },
        },
      },
      orderBy: [{ key: 'asc' }],
    })

    const companyMap = new Map<string, string>()
    if (flags.some(f => f.tenant_overrides.length > 0)) {
      const companies = await prisma.company.findMany({ select: { id: true, name: true } })
      for (const c of companies) companyMap.set(c.id, c.name)
    }

    return success(flags.map(f => ({
      key: f.key,
      description: f.description,
      strategy: f.strategy,
      rollout_pct: f.rollout_pct,
      created_at: f.created_at,
      updated_at: f.updated_at,
      tenant_overrides: f.tenant_overrides.map(o => ({
        company_id: o.company_id,
        company_name: companyMap.get(o.company_id) ?? o.company_id,
        enabled: o.enabled,
        enabled_at: o.enabled_at,
      })),
    })))
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const body = createSchema.parse(await request.json())

    const flag = await prisma.featureFlag.create({
      data: {
        key: body.key,
        description: body.description ?? null,
        strategy: body.strategy,
        rollout_pct: body.rollout_pct,
      },
    })

    return success({ key: flag.key }, 201)
  } catch (err) {
    return handleError(err)
  }
}
