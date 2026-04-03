import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { createRoleSchema } from '@pontual/utils/validation'

export async function GET() {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Only admins can list roles
    if (user.roleName !== 'admin') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const roles = await prisma.role.findMany({
      where: { company_id: user.companyId },
      include: {
        _count: { select: { user_profiles: true } },
        role_permissions: {
          where: { granted: true },
          include: { permissions: { select: { id: true, module: true, action: true } } },
        },
      },
      orderBy: { name: 'asc' },
    })

    const formatted = roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.is_system,
      isActive: role.is_active,
      userCount: role._count.user_profiles,
      permissionCount: role.role_permissions.length,
      createdAt: role.created_at,
    }))

    return success(formatted)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('core', 'create')
    if (result instanceof NextResponse) return result
    const admin = result

    const body = await request.json()
    const data = createRoleSchema.parse(body)

    // Verificar duplicata
    const existing = await prisma.role.findFirst({
      where: { company_id: admin.companyId, name: data.name },
    })
    if (existing) return error('Já existe um cargo com este nome', 409)

    const role = await prisma.role.create({
      data: {
        company_id: admin.companyId,
        name: data.name,
        description: data.description,
      },
    })

    logAudit({
      companyId: admin.companyId,
      userId: admin.id,
      module: 'core',
      action: 'create_role',
      entityId: role.id,
      newValue: { name: data.name },
    })

    return success(role, 201)
  } catch (err) {
    return handleError(err)
  }
}
