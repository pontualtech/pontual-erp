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

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  is_active: z.boolean().optional(),
  applies_to_segment: z.string().max(120).nullable().optional(),
  steps: z.array(stepSchema).min(1).max(20).optional(),
})

export async function GET(_request: NextRequest, ctx: { params: { id: string } }) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const rule = await prisma.cobrancaRule.findFirst({
      where: { id: ctx.params.id, company_id: user.companyId },
      include: { steps: { orderBy: { step_order: 'asc' } } },
    })
    if (!rule) return apiError('Régua não encontrada', 404)

    return success({
      id: rule.id,
      name: rule.name,
      is_active: rule.is_active,
      applies_to_segment: rule.applies_to_segment,
      steps: rule.steps.map(s => ({
        id: s.id,
        step_order: s.step_order,
        trigger_days_offset: s.trigger_days_offset,
        channel: s.channel,
        template_id: s.template_id,
        apply_fee_pct: Number(s.apply_fee_pct ?? 0),
        apply_interest_pct_monthly: Number(s.apply_interest_pct_monthly ?? 0),
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(request: NextRequest, ctx: { params: { id: string } }) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = updateSchema.parse(await request.json())

    const exists = await prisma.cobrancaRule.findFirst({
      where: { id: ctx.params.id, company_id: user.companyId },
      select: { id: true },
    })
    if (!exists) return apiError('Régua não encontrada', 404)

    if (body.steps) {
      const orders = body.steps.map(s => s.step_order)
      if (new Set(orders).size !== orders.length) {
        return apiError('step_order duplicado', 422)
      }
    }

    await prisma.$transaction(async tx => {
      const data: any = {}
      if (body.name !== undefined) data.name = body.name
      if (body.is_active !== undefined) data.is_active = body.is_active
      if (body.applies_to_segment !== undefined) data.applies_to_segment = body.applies_to_segment

      if (Object.keys(data).length > 0) {
        await tx.cobrancaRule.update({ where: { id: ctx.params.id }, data })
      }

      if (body.steps) {
        // Replace steps wholesale
        await tx.cobrancaRuleStep.deleteMany({ where: { rule_id: ctx.params.id } })
        await tx.cobrancaRuleStep.createMany({
          data: body.steps.map(s => ({
            company_id: user.companyId,
            rule_id: ctx.params.id,
            step_order: s.step_order,
            trigger_days_offset: s.trigger_days_offset,
            channel: s.channel,
            template_id: s.template_id ?? null,
            apply_fee_pct: s.apply_fee_pct ?? 0,
            apply_interest_pct_monthly: s.apply_interest_pct_monthly ?? 0,
          })),
        })
      }
    })

    return success({ ok: true })
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_request: NextRequest, ctx: { params: { id: string } }) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const exists = await prisma.cobrancaRule.findFirst({
      where: { id: ctx.params.id, company_id: user.companyId },
      select: { id: true },
    })
    if (!exists) return apiError('Régua não encontrada', 404)

    // Soft-disable em vez de delete físico (preserva auditoria de PaymentReminders já criados)
    await prisma.cobrancaRule.update({
      where: { id: ctx.params.id },
      data: { is_active: false },
    })

    return success({ ok: true })
  } catch (err) {
    return handleError(err)
  }
}
