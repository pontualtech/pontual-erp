/**
 * GET /api/voip/extensions
 *
 * Lista os ramais ativos do tenant com nome do user, role e telefone.
 * Util pra UI "Lista de Ramais" — atendente sabe quem é cada extensao.
 *
 * Source: env SONAX_RAMAL_MAPPING (email -> ramal) cruzado com user_profiles.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requireAuth } from '@/lib/auth'
import { handleError, success } from '@/lib/api-response'
import { listExtensionMappings } from '@/lib/voip/extensionMap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth()

    // Tenta primeiro a nova tabela voip_extensions (PontualPABX). Se vazia,
    // fallback pro env SONAX_RAMAL_MAPPING (transição).
    const dbExt = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT e.number, e.description, e.is_active,
              e.user_id, u.name AS user_name, u.email AS user_email,
              u.phone, u.role_id, u.last_login_at
       FROM voip_extensions e
       LEFT JOIN user_profiles u ON u.id = e.user_id
       WHERE e.company_id = $1 AND e.is_active = true
       ORDER BY e.number`,
      user.companyId,
    ).catch(() => [])

    if (dbExt.length > 0) {
      const result = dbExt.map(e => ({
        ramal: e.number,
        email: e.user_email || '',
        name: e.user_name || e.description.replace(/\s*-\s*Ramal.*$/, ''),
        role: e.role_id?.replace('role-', '') || null,
        phone: e.phone || null,
        userId: e.user_id || null,
        lastLoginAt: e.last_login_at?.toISOString?.() || null,
      }))
      return success(result)
    }

    // Fallback env mapping (legacy)
    const mappings = listExtensionMappings()
    if (!mappings.length) return success([])

    const emails = mappings.map(m => m.email)
    const users = await prisma.userProfile.findMany({
      where: { company_id: user.companyId, email: { in: emails }, is_active: true },
      select: {
        id: true, name: true, email: true, role_id: true, phone: true, last_login_at: true,
      },
    })

    const result = mappings.map(m => {
      const u = users.find(x => x.email.toLowerCase() === m.email)
      return {
        ramal: m.ramal,
        email: m.email,
        name: u?.name || m.email.split('@')[0],
        role: u?.role_id?.replace('role-', '') || null,
        phone: u?.phone || null,
        userId: u?.id || null,
        lastLoginAt: u?.last_login_at?.toISOString() || null,
      }
    }).sort((a, b) => a.ramal.localeCompare(b.ramal))

    return success(result)
  } catch (e) {
    return handleError(e)
  }
}
