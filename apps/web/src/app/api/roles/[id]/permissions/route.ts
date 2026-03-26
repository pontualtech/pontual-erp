import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { setPermissionsSchema } from '@pontual/utils/validation'

type Params = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const role = await prisma.role.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!role) return error('Cargo não encontrado', 404)

    // Buscar todas as permissões do sistema
    const allPermissions = await prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    })

    // Buscar permissões concedidas ao role
    const rolePermissions = await prisma.rolePermission.findMany({
      where: { role_id: params.id, company_id: user.companyId },
      select: { permission_id: true, granted: true },
    })

    const grantedMap = new Map(rolePermissions.map((rp) => [rp.permission_id, rp.granted]))

    // Agrupar por módulo com status de granted
    const grouped: Record<string, Array<{ id: string; action: string; description: string | null; granted: boolean }>> = {}
    for (const perm of allPermissions) {
      if (!grouped[perm.module]) grouped[perm.module] = []
      grouped[perm.module].push({
        id: perm.id,
        action: perm.action,
        description: perm.description,
        granted: grantedMap.get(perm.id) ?? false,
      })
    }

    return success({ roleId: params.id, roleName: role.name, permissions: grouped })
  } catch (err) {
    return handleError(err)
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'edit')
    if (result instanceof NextResponse) return result
    const admin = result

    const body = await request.json()
    const { permissions } = setPermissionsSchema.parse(body)

    const role = await prisma.role.findFirst({
      where: { id: params.id, company_id: admin.companyId },
    })
    if (!role) return error('Cargo não encontrado', 404)
    if (role.is_system) return error('Permissões de cargos de sistema não podem ser alteradas', 403)

    // Upsert em transação: deletar existentes e recriar
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({
        where: { role_id: params.id, company_id: admin.companyId },
      })

      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({
            company_id: admin.companyId,
            role_id: params.id,
            permission_id: p.permissionId,
            granted: p.granted,
          })),
        })
      }
    })

    logAudit({
      companyId: admin.companyId,
      userId: admin.id,
      module: 'core',
      action: 'update_permissions',
      entityId: params.id,
      newValue: { permissions: permissions.filter((p) => p.granted).length },
    })

    return success({ message: 'Permissões atualizadas com sucesso' })
  } catch (err) {
    return handleError(err)
  }
}
