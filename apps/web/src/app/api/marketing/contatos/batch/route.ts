/**
 * Batch ops em marketing_contacts — usado pelo multi-select do Kanban.
 *
 * PATCH /api/marketing/contatos/batch
 *
 * Body: {
 *   ids: string[],         // até 200 ids
 *   action: 'set_stage' | 'add_tags' | 'remove_tags' | 'unsubscribe' | 'delete',
 *   payload: { ... }       // depende de action
 * }
 *
 * Notas:
 * - Todas as ops são tenant-safe (where company_id filtrado em cada update)
 * - 'delete' usa Prisma deleteMany — irreversível
 * - 'set_stage' dispara automations matching pra CADA contato (loop fire-and-forget)
 * - Retorno: { affected: N, skipped: M, errors: [] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { z } from 'zod'
import { STAGE_KEYS } from '@/lib/marketing/stages'
import { fireStageAutomations } from '@/lib/marketing/automations/executor'

const MAX_IDS = 200

const setStageSchema = z.object({
  action: z.literal('set_stage'),
  ids: z.array(z.string()).min(1).max(MAX_IDS),
  payload: z.object({
    stage: z.enum([...STAGE_KEYS as [string, ...string[]], 'none']),
  }),
})

const addTagsSchema = z.object({
  action: z.literal('add_tags'),
  ids: z.array(z.string()).min(1).max(MAX_IDS),
  payload: z.object({
    tags: z.array(z.string().min(1).max(60)).min(1).max(20),
  }),
})

const removeTagsSchema = z.object({
  action: z.literal('remove_tags'),
  ids: z.array(z.string()).min(1).max(MAX_IDS),
  payload: z.object({
    tags: z.array(z.string().min(1).max(60)).min(1).max(20),
  }),
})

const unsubscribeSchema = z.object({
  action: z.literal('unsubscribe'),
  ids: z.array(z.string()).min(1).max(MAX_IDS),
  payload: z.object({}).optional(),
})

const deleteSchema = z.object({
  action: z.literal('delete'),
  ids: z.array(z.string()).min(1).max(MAX_IDS),
  payload: z.object({}).optional(),
})

const bodySchema = z.discriminatedUnion('action', [
  setStageSchema,
  addTagsSchema,
  removeTagsSchema,
  unsubscribeSchema,
  deleteSchema,
])

function ensureAdmin(user: { isSuperAdmin: boolean; roleName: string }) {
  if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }
  return null
}

export async function PATCH(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const body = bodySchema.parse(await req.json())

    // Carrega contatos elegíveis (filtra company_id pra prevenir cross-tenant)
    const contacts = await prisma.marketingContact.findMany({
      where: {
        id: { in: body.ids },
        company_id: user.companyId,
      },
      select: { id: true, tags: true, unsubscribed: true },
    })
    if (contacts.length === 0) {
      return error('Nenhum contato encontrado.', 404)
    }

    let affected = 0
    const errors: { id: string; reason: string }[] = []

    switch (body.action) {
      // --------------------------------------------------------------
      case 'set_stage': {
        const newStage = body.payload.stage
        for (const c of contacts) {
          try {
            const oldStageTag = c.tags.find(t => t.startsWith('stage:'))
            const fromStage = oldStageTag ? oldStageTag.slice(6) : null
            const toStage = newStage === 'none' ? null : newStage
            const tagsWithoutStage = c.tags.filter(t => !t.startsWith('stage:'))
            const newTags = toStage ? [...tagsWithoutStage, `stage:${toStage}`] : tagsWithoutStage
            await prisma.marketingContact.update({
              where: { id: c.id },
              data: { tags: newTags, updated_at: new Date() },
            })
            affected++
            // Dispara automations (fire-and-forget, não bloqueia loop)
            if (fromStage !== toStage) {
              fireStageAutomations({
                companyId: user.companyId,
                contactId: c.id,
                fromStage,
                toStage,
              }).catch(err => console.error('[batch] fire automation error:', err))
            }
          } catch (e: any) {
            errors.push({ id: c.id, reason: e?.message?.slice(0, 100) || 'error' })
          }
        }
        break
      }

      // --------------------------------------------------------------
      case 'add_tags': {
        const tagsToAdd = body.payload.tags
        for (const c of contacts) {
          try {
            const existing = new Set(c.tags || [])
            tagsToAdd.forEach(t => existing.add(t))
            await prisma.marketingContact.update({
              where: { id: c.id },
              data: { tags: [...existing], updated_at: new Date() },
            })
            affected++
          } catch (e: any) {
            errors.push({ id: c.id, reason: e?.message?.slice(0, 100) || 'error' })
          }
        }
        break
      }

      // --------------------------------------------------------------
      case 'remove_tags': {
        const tagsToRemove = new Set(body.payload.tags)
        for (const c of contacts) {
          try {
            const filtered = (c.tags || []).filter(t => !tagsToRemove.has(t))
            if (filtered.length !== (c.tags || []).length) {
              await prisma.marketingContact.update({
                where: { id: c.id },
                data: { tags: filtered, updated_at: new Date() },
              })
              affected++
            }
          } catch (e: any) {
            errors.push({ id: c.id, reason: e?.message?.slice(0, 100) || 'error' })
          }
        }
        break
      }

      // --------------------------------------------------------------
      case 'unsubscribe': {
        const updated = await prisma.marketingContact.updateMany({
          where: { id: { in: contacts.map(c => c.id) }, company_id: user.companyId },
          data: { unsubscribed: true, unsubscribed_at: new Date(), updated_at: new Date() },
        })
        affected = updated.count
        break
      }

      // --------------------------------------------------------------
      case 'delete': {
        const deleted = await prisma.marketingContact.deleteMany({
          where: { id: { in: contacts.map(c => c.id) }, company_id: user.companyId },
        })
        affected = deleted.count
        break
      }
    }

    const skipped = body.ids.length - contacts.length

    return success({
      affected,
      skipped,
      notFound: skipped,
      errors,
      action: body.action,
    })
  } catch (e: any) {
    if (e?.errors && Array.isArray(e.errors)) {
      return error('Validação: ' + e.errors.map((x: any) => `${x.path.join('.')} ${x.message}`).join('; '), 400)
    }
    return handleError(e)
  }
}
