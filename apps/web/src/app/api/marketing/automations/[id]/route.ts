/**
 * Marketing Stage Automation — GET / PATCH / DELETE de uma regra específica.
 * GET retorna automation + últimas 20 execuções pra debug.
 * PATCH aceita campos parciais. DELETE remove (cascade nas runs).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { z } from 'zod'
import { STAGE_KEYS } from '@/lib/marketing/stages'

const stageEnum = z.enum([...STAGE_KEYS as [string, ...string[]], ''])

const patchSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  from_stage: stageEnum.optional(),
  to_stage: stageEnum.optional(),
  payload: z.record(z.any()).optional(),
  delay_minutes: z.number().int().min(0).max(43200).optional(),
  active: z.boolean().optional(),
}).strict()

function ensureAdmin(user: { isSuperAdmin: boolean; roleName: string }) {
  if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }
  return null
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const automation = await prisma.marketingStageAutomation.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!automation) return error('Automação não encontrada', 404)

    const recentRuns = await prisma.marketingAutomationRun.findMany({
      where: { automation_id: automation.id, company_id: user.companyId },
      orderBy: { created_at: 'desc' },
      take: 20,
    })

    return success({ automation, recentRuns })
  } catch (e) {
    return handleError(e)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const body = patchSchema.parse(await req.json())

    const current = await prisma.marketingStageAutomation.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!current) return error('Automação não encontrada', 404)

    // Constrói patch data — converte '' em null pra stages
    const data: any = { updated_at: new Date() }
    if (body.name !== undefined) data.name = body.name
    if (body.from_stage !== undefined) data.from_stage = body.from_stage || null
    if (body.to_stage !== undefined) data.to_stage = body.to_stage || null
    if (body.payload !== undefined) data.payload = body.payload
    if (body.delay_minutes !== undefined) data.delay_minutes = body.delay_minutes
    if (body.active !== undefined) data.active = body.active

    // Valida que não fica com ambos stages null
    const newFrom = data.from_stage !== undefined ? data.from_stage : current.from_stage
    const newTo = data.to_stage !== undefined ? data.to_stage : current.to_stage
    if (!newFrom && !newTo) {
      return error('Pelo menos um from_stage ou to_stage deve estar definido.', 400)
    }

    const updated = await prisma.marketingStageAutomation.update({
      where: { id: current.id },
      data,
    })

    return success({ automation: updated })
  } catch (e: any) {
    if (e?.errors && Array.isArray(e.errors)) {
      return error('Validação: ' + e.errors.map((x: any) => `${x.path.join('.')} ${x.message}`).join('; '), 400)
    }
    return handleError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const automation = await prisma.marketingStageAutomation.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!automation) return error('Automação não encontrada', 404)

    await prisma.marketingStageAutomation.delete({ where: { id: automation.id } })
    return success({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
