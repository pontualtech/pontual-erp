import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { z } from 'zod'

// Stages válidos — bate com STAGES[] em lib/marketing/stages.ts
const STAGE_KEYS = [
  'lead_aguardando',
  'em_negociacao',
  'cliente_em_servico',
  'cliente_atendido',
  'perdido_recusou',
] as const

const bodySchema = z.object({
  stage: z.enum([...STAGE_KEYS, 'none']),
}).strict()

function ensureAdmin(user: { isSuperAdmin: boolean; roleName: string }) {
  if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }
  return null
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const { stage } = bodySchema.parse(await req.json())

    const contact = await prisma.marketingContact.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!contact) return error('Contato não encontrado', 404)

    // Remove tags stage:* existentes
    const tagsWithoutStage = (contact.tags || []).filter(t => !t.startsWith('stage:'))
    // Adiciona nova tag stage (a menos que 'none')
    const newTags = stage === 'none'
      ? tagsWithoutStage
      : [...tagsWithoutStage, `stage:${stage}`]

    const updated = await prisma.marketingContact.update({
      where: { id: contact.id },
      data: {
        tags: newTags,
        updated_at: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        tags: true,
        updated_at: true,
      },
    })

    return success({ contact: updated, stage })
  } catch (e) {
    return handleError(e)
  }
}
