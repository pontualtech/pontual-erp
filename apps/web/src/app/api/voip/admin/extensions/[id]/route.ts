/**
 * PUT    /api/voip/admin/extensions/[id]   — atualiza ramal (description, user, webrtc, etc)
 * DELETE /api/voip/admin/extensions/[id]   — remove ramal (soft? por agora hard delete)
 *
 * Auth: requireAuth + admin role + same-tenant.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requireAuth } from '@/lib/auth'
import { error, handleError, success } from '@/lib/api-response'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// N30 fix (audit pos-fix): testava roleId que é UUID — sempre false.
// Resultado: ninguém exceto super_admin conseguia editar/deletar ramal.
// Agora usa roleName (já lowercased em auth.ts).
function isAdmin(roleName: string | null | undefined): boolean {
  if (!roleName) return false
  return roleName === 'admin' || roleName === 'administrador'
}

const UpdateBody = z.object({
  description: z.string().min(2).max(120).optional(),
  caller_id_internal: z.string().max(120).nullable().optional(),
  user_id: z.string().nullable().optional(),
  webrtc: z.boolean().optional(),
  max_contacts: z.number().int().min(1).max(10).optional(),
  call_limit: z.number().int().min(1).max(20).optional(),
  is_active: z.boolean().optional(),
})

async function ownsExtension(extId: string, companyId: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM voip_extensions WHERE id=$1 AND company_id=$2 LIMIT 1`, extId, companyId,
  )
  return r.length > 0
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireAuth()
    if (!user.isSuperAdmin && !isAdmin(user.roleName)) return error('Permissao admin requerida', 403)

    if (!(await ownsExtension(params.id, user.companyId))) {
      return error('Ramal nao encontrado', 404)
    }

    const json = await req.json().catch(() => null)
    if (!json) return error('Body invalido', 400)
    const body = UpdateBody.parse(json)

    const sets: string[] = []
    const vals: unknown[] = []
    let idx = 1
    if (body.description !== undefined) { sets.push(`description=$${idx++}`); vals.push(body.description) }
    if (body.caller_id_internal !== undefined) { sets.push(`caller_id_internal=$${idx++}`); vals.push(body.caller_id_internal) }
    if (body.user_id !== undefined) {
      if (body.user_id) {
        const u = await prisma.userProfile.findFirst({
          where: { id: body.user_id, company_id: user.companyId }, select: { id: true },
        })
        if (!u) return error('User nao encontrado neste tenant', 400)
      }
      sets.push(`user_id=$${idx++}`); vals.push(body.user_id)
    }
    if (body.webrtc !== undefined) { sets.push(`webrtc=$${idx++}`); vals.push(body.webrtc) }
    if (body.max_contacts !== undefined) { sets.push(`max_contacts=$${idx++}`); vals.push(body.max_contacts) }
    if (body.call_limit !== undefined) { sets.push(`call_limit=$${idx++}`); vals.push(body.call_limit) }
    if (body.is_active !== undefined) { sets.push(`is_active=$${idx++}`); vals.push(body.is_active) }
    if (sets.length === 0) return error('Nada pra atualizar', 400)
    sets.push(`updated_at=now()`)

    vals.push(params.id)
    await prisma.$executeRawUnsafe(
      `UPDATE voip_extensions SET ${sets.join(', ')} WHERE id=$${idx}`,
      ...vals,
    )

    return success({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireAuth()
    if (!user.isSuperAdmin && !isAdmin(user.roleName)) return error('Permissao admin requerida', 403)

    if (!(await ownsExtension(params.id, user.companyId))) {
      return error('Ramal nao encontrado', 404)
    }

    await prisma.$executeRawUnsafe(`DELETE FROM voip_extensions WHERE id=$1`, params.id)
    return success({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
