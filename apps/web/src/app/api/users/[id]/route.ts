import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { updateUserSchema, assignRoleSchema } from '@pontual/utils/validation'

type Params = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // IDOR protection: non-admin can only read their own profile
    if (user.roleName !== 'admin' && user.id !== params.id) {
      return error('Acesso negado', 403)
    }

    const profile = await prisma.userProfile.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        roles: { select: { id: true, name: true } },
        companies: { select: { id: true, name: true, slug: true } },
      },
    })

    if (!profile) return error('Usuário não encontrado', 404)

    return success(profile)
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

    // Se está atribuindo role, validar separadamente
    if (body.roleId && Object.keys(body).length === 1) {
      const { roleId } = assignRoleSchema.parse(body)
      const role = await prisma.role.findFirst({
        where: { id: roleId, company_id: admin.companyId },
      })
      if (!role) return error('Cargo não encontrado', 404)
    }

    const data = updateUserSchema.parse(body)

    const existing = await prisma.userProfile.findFirst({
      where: { id: params.id, company_id: admin.companyId },
    })
    if (!existing) return error('Usuário não encontrado', 404)

    const updateData: any = {
      ...data,
      ...(data.preferences ? { preferences: data.preferences as any } : {}),
      ...(body.roleId ? { role_id: body.roleId } : {}),
      ...(body.isActive !== undefined ? { is_active: body.isActive } : {}),
    }

    // Update password in Supabase Auth if provided
    if (body.password) {
      const supabaseAdmin = createAdminClient()
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        params.id,
        { password: body.password }
      )
      if (authError) {
        return error(authError.message || 'Erro ao atualizar senha', 500)
      }
    }

    const updated = await prisma.userProfile.update({
      where: { id_company_id: { id: params.id, company_id: admin.companyId } },
      data: updateData,
      include: { roles: { select: { id: true, name: true } } },
    })

    logAudit({
      companyId: admin.companyId,
      userId: admin.id,
      module: 'core',
      action: 'update_user',
      entityId: params.id,
      oldValue: { name: existing.name, email: existing.email },
      newValue: { name: updated.name, email: updated.email },
    })

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'delete')
    if (result instanceof NextResponse) return result
    const admin = result

    if (params.id === admin.id) {
      return error('Você não pode desativar sua própria conta', 400)
    }

    const existing = await prisma.userProfile.findFirst({
      where: { id: params.id, company_id: admin.companyId },
    })
    if (!existing) return error('Usuário não encontrado', 404)

    // Soft delete: desativar o perfil
    await prisma.userProfile.update({
      where: { id_company_id: { id: params.id, company_id: admin.companyId } },
      data: { is_active: false },
    })

    logAudit({
      companyId: admin.companyId,
      userId: admin.id,
      module: 'core',
      action: 'delete_user',
      entityId: params.id,
      oldValue: { name: existing.name, isActive: true },
    })

    return success({ message: 'Usuário desativado com sucesso' })
  } catch (err) {
    return handleError(err)
  }
}
