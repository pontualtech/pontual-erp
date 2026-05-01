/**
 * GET  /api/voip/admin/extensions    — lista todos ramais do tenant
 * POST /api/voip/admin/extensions    — cria novo ramal
 *
 * Auth: requireAuth + admin role.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requireAuth } from '@/lib/auth'
import { error, handleError, success } from '@/lib/api-response'
import { z } from 'zod'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function genSecret(): string {
  return crypto.randomBytes(18).toString('base64').replace(/[+/=]/g, '').slice(0, 24)
}

function isAdmin(roleId: string | null | undefined): boolean {
  if (!roleId) return false
  return /admin/i.test(roleId)
}

const CreateBody = z.object({
  number: z.string().regex(/^\d{2,5}$/, 'Numero deve ter 2-5 digitos'),
  description: z.string().min(2).max(120),
  user_id: z.string().nullable().optional(),
  webrtc: z.boolean().default(true),
  max_contacts: z.number().int().min(1).max(10).default(1),
  call_limit: z.number().int().min(1).max(20).default(1),
  caller_id_internal: z.string().max(120).nullable().optional(),
})

export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.isSuperAdmin && !isAdmin(user.roleId)) return error('Permissao admin requerida', 403)

    const items = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT e.id, e.number, e.description, e.caller_id_internal, e.webrtc, e.max_contacts,
              e.call_limit, e.is_active, e.created_at, e.updated_at,
              e.user_id, u.name AS user_name, u.email AS user_email
       FROM voip_extensions e
       LEFT JOIN user_profiles u ON u.id = e.user_id
       WHERE e.company_id = $1
       ORDER BY e.number`,
      user.companyId,
    )

    return success(items)
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.isSuperAdmin && !isAdmin(user.roleId)) return error('Permissao admin requerida', 403)

    const json = await req.json().catch(() => null)
    if (!json) return error('Body invalido', 400)
    const body = CreateBody.parse(json)

    // Verifica se numero ja existe
    const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM voip_extensions WHERE company_id=$1 AND number=$2 LIMIT 1`,
      user.companyId, body.number,
    )
    if (existing.length > 0) return error(`Ramal ${body.number} ja existe`, 409)

    // Se user_id passado, valida same-tenant
    if (body.user_id) {
      const u = await prisma.userProfile.findFirst({
        where: { id: body.user_id, company_id: user.companyId },
        select: { id: true },
      })
      if (!u) return error('User nao encontrado neste tenant', 400)
    }

    const id = crypto.randomUUID()
    const secret = genSecret()
    await prisma.$executeRawUnsafe(
      `INSERT INTO voip_extensions
       (id, company_id, number, description, caller_id_internal, user_id, webrtc, max_contacts, call_limit, secret_plain, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
      id, user.companyId, body.number, body.description,
      body.caller_id_internal || null, body.user_id || null,
      body.webrtc, body.max_contacts, body.call_limit, secret,
    )

    return success({ id, number: body.number, secret_plain: secret })
  } catch (e) {
    return handleError(e)
  }
}
