import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError, error as apiError } from '@/lib/api-response'

const stepSchema = z.object({
  step_order: z.number().int().min(1).max(20),
  trigger_days_offset: z.number().int().min(-90).max(180),
  channel: z.enum(['WHATSAPP', 'EMAIL', 'SMS']),
  template_id: z.string().nullable().optional(),
  apply_fee_pct: z.number().min(0).max(100).optional().default(0),
  apply_interest_pct_monthly: z.number().min(0).max(100).optional().default(0),
})

const createSchema = z.object({
  name: z.string().min(1).max(120),
  is_active: z.boolean().optional().default(true),
  applies_to_segment: z.string().max(120).nullable().optional(),
  steps: z.array(stepSchema).min(1).max(20),
})

export async function GET(_request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const rules = await prisma.cobrancaRule.findMany({
      where: { company_id: user.companyId },
      include: { steps: { orderBy: { step_order: 'asc' } } },
      orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }],
    })

    return success(rules.map(r => ({
      id: r.id,
      name: r.name,
      is_active: r.is_active,
      applies_to_segment: r.applies_to_segment,
      created_at: r.created_at,
      updated_at: r.updated_at,
      steps_count: r.steps.length,
      steps: r.steps.map(s => ({
        id: s.id,
        step_order: s.step_order,
        trigger_days_offset: s.trigger_days_offset,
        channel: s.channel,
        template_id: s.template_id,
        apply_fee_pct: Number(s.apply_fee_pct ?? 0),
        apply_interest_pct_monthly: Number(s.apply_interest_pct_monthly ?? 0),
      })),
    })))
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = createSchema.parse(await request.json())

    // step_order deve ser único e crescente
    const orders = body.steps.map(s => s.step_order)
    if (new Set(orders).size !== orders.length) {
      return apiError('step_order duplicado', 422)
    }

    const rule = await prisma.$transaction(async tx => {
      const r = await tx.cobrancaRule.create({
        data: {
          company_id: user.companyId,
          name: body.name,
          is_active: body.is_active,
          applies_to_segment: body.applies_to_segment ?? null,
        },
      })
      await tx.cobrancaRuleStep.createMany({
        data: body.steps.map(s => ({
          company_id: user.companyId,
          rule_id: r.id,
          step_order: s.step_order,
          trigger_days_offset: s.trigger_days_offset,
          channel: s.channel,
          template_id: s.template_id ?? null,
          apply_fee_pct: s.apply_fee_pct ?? 0,
          apply_interest_pct_monthly: s.apply_interest_pct_monthly ?? 0,
        })),
      })
      return r
    })

    return success({ id: rule.id }, 201)
  } catch (err) {
    return handleError(err)
  }
}
