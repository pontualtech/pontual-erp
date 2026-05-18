/**
 * Marketing Stage Automations — CRUD list + create.
 *
 * Regra: usuário admin pode criar regras "quando contato move de A pra B,
 * dispare X (email/whatsapp/webhook/task)". Cada empresa tem suas próprias
 * regras (multi-tenant via company_id).
 *
 * - from_stage/to_stage: '' (string vazia) = "qualquer fase" → vira NULL no DB.
 * - payload é jsonb genérico — formato depende do action_type, validado
 *   por sub-schemas abaixo.
 * - delay_minutes default 0 (imediato). MVP usa 0; drip futuro >0.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { z } from 'zod'
import { STAGE_KEYS } from '@/lib/marketing/stages'

const stageEnum = z.enum([...STAGE_KEYS as [string, ...string[]], ''])

// Sub-schemas por action_type — usados como discriminated union no payload.
const emailPayloadSchema = z.object({
  subject: z.string().min(1).max(200).trim(),
  html: z.string().min(1).max(50000),
  campaignTag: z.string().min(3).max(60).regex(/^[a-z0-9_]+$/, 'a-z 0-9 _ apenas'),
}).strict()

const whatsappPayloadSchema = z.object({
  templateName: z.string().min(1).max(120),
  templateLanguage: z.string().default('pt_BR'),
  // Variáveis posicionais do template (string substituídas no envio)
  variables: z.array(z.string()).max(10).default([]),
}).strict()

const webhookPayloadSchema = z.object({
  url: z.string().url(),
  method: z.enum(['POST', 'GET', 'PUT']).default('POST'),
  // Headers extra (auth, etc) — chaves limitadas a A-Z, 0-9, hifen
  headers: z.record(z.string().regex(/^[A-Za-z0-9-]+$/), z.string()).optional(),
  // Body é stringificado e renderizado no envio com handlebars-like
  bodyTemplate: z.string().max(10000).optional(),
}).strict()

const taskPayloadSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).optional(),
  assignToUserId: z.string().optional(),
  dueDays: z.number().int().min(0).max(365).default(0),
}).strict()

const ACTION_PAYLOADS = {
  email: emailPayloadSchema,
  whatsapp: whatsappPayloadSchema,
  webhook: webhookPayloadSchema,
  task: taskPayloadSchema,
} as const

const baseAutomationSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  from_stage: stageEnum.optional().default(''),
  to_stage: stageEnum.optional().default(''),
  action_type: z.enum(['email', 'whatsapp', 'webhook', 'task']),
  payload: z.record(z.any()),
  delay_minutes: z.number().int().min(0).max(43200).default(0), // até 30 dias
  active: z.boolean().default(true),
})

function ensureAdmin(user: { isSuperAdmin: boolean; roleName: string }) {
  if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }
  return null
}

/** Valida payload conforme action_type. Retorna mensagem de erro ou null. */
function validatePayload(actionType: string, payload: unknown): string | null {
  const schema = (ACTION_PAYLOADS as any)[actionType]
  if (!schema) return `action_type desconhecido: ${actionType}`
  const r = schema.safeParse(payload)
  if (!r.success) {
    return 'payload inválido: ' + r.error.errors.map((e: any) => `${e.path.join('.')} ${e.message}`).join('; ')
  }
  return null
}

export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const automations = await prisma.marketingStageAutomation.findMany({
      where: { company_id: user.companyId },
      orderBy: [{ active: 'desc' }, { created_at: 'desc' }],
    })

    return success({ automations, total: automations.length })
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const body = baseAutomationSchema.parse(await req.json())

    // Garante que ao menos um stage está definido
    if (!body.from_stage && !body.to_stage) {
      return error('Defina at least from_stage ou to_stage (ou ambos).', 400)
    }

    const payloadError = validatePayload(body.action_type, body.payload)
    if (payloadError) return error(payloadError, 400)

    const automation = await prisma.marketingStageAutomation.create({
      data: {
        company_id: user.companyId,
        name: body.name,
        from_stage: body.from_stage || null,
        to_stage: body.to_stage || null,
        action_type: body.action_type,
        payload: body.payload as any,
        delay_minutes: body.delay_minutes,
        active: body.active,
        created_by: user.id,
      },
    })

    return success({ automation }, 201)
  } catch (e: any) {
    if (e?.errors && Array.isArray(e.errors)) {
      return error('Validação: ' + e.errors.map((x: any) => `${x.path.join('.')} ${x.message}`).join('; '), 400)
    }
    return handleError(e)
  }
}
