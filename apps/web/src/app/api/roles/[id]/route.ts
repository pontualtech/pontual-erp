import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { updateRoleSchema } from '@pontual/utils/validation'

type Params = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const role = await prisma.role.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        _count: { select: { user_profiles: true } },
        role_permissions: {
          where: { granted: true },
          include: { permissions: true },
        },
      },
    })

    if (!role) return error('Cargo não encontrado', 404)

    return success({
      ...role,
      userCount: role._count.user_profiles,
      permissions: role.role_permissions.map((rp) => ({
        id: rp.permissions.id,
        module: rp.permissions.module,
        action: rp.permissions.action,
        description: rp.permissions.description,
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const admin = result

    // Only admin can edit roles
    if (admin.roleName !== 'admin') return error('Apenas administradores podem editar cargos', 403)

    const body = await request.json()
    const data = updateRoleSchema.parse(body)

    const existing = await prisma.role.findFirst({
      where: { id: params.id, company_id: admin.companyId },
    })
    if (!existing) return error('Cargo não encontrado', 404)
    if (existing.is_system) return error('Cargos de sistema não podem ser editados', 403)

    // Protect default role names from being renamed
    const protectedNames = ['admin', 'atendente', 'financeiro', 'técnico', 'motorista']
    if (protectedNames.includes(existing.name.toLowerCase()) && data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      return error('Cargos padrão não podem ser renomeados', 403)
    }

    const updated = await prisma.role.update({
      where: { id: params.id },
      data,
    })

    logAudit({
      companyId: admin.companyId,
      userId: admin.id,
      module: 'core',
      action: 'update_role',
      entityId: params.id,
      oldValue: { name: existing.name },
      newValue: { name: updated.name },
    })

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const admin = result

    const role = await prisma.role.findFirst({
      where: { id: params.id, company_id: admin.companyId },
      include: { _count: { select: { user_profiles: true } } },
    })

    if (!role) return error('Cargo não encontrado', 404)
    if (role.is_system) return error('Cargos de sistema não podem ser excluídos', 403)
    if (role._count.user_profiles > 0) return error('Cargo possui usuários vinculados. Mova-os primeiro.', 400)

    await prisma.role.delete({ where: { id: params.id } })

    logAudit({
      companyId: admin.companyId,
      userId: admin.id,
      module: 'core',
      action: 'delete_role',
      entityId: params.id,
      oldValue: { name: role.name },
    })

    return success({ message: 'Cargo excluído com sucesso' })
  } catch (err) {
    return handleError(err)
  }
}
