import { NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET() {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result

    const permissions = await prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    })

    // Agrupar por módulo
    const grouped: Record<string, Array<{
      id: string
      action: string
      description: string | null
    }>> = {}

    for (const perm of permissions) {
      if (!grouped[perm.module]) grouped[perm.module] = []
      grouped[perm.module].push({
        id: perm.id,
        action: perm.action,
        description: perm.description,
      })
    }

    return success(grouped)
  } catch (err) {
    return handleError(err)
  }
}
