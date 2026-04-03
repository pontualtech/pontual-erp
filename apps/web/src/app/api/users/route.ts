import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { paginationSchema, createUserSchema } from '@pontual/utils/validation'
import { randomBytes } from 'crypto'

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Only admins can list all users
    if (user.roleName !== 'admin') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const params = Object.fromEntries(request.nextUrl.searchParams)
    const { page, limit, search, sortBy, sortOrder } = paginationSchema.parse(params)

    const where: Record<string, unknown> = { company_id: user.companyId }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    const sortField = sortBy === 'createdAt' ? 'created_at' : (sortBy || 'name')
    const [users, total] = await Promise.all([
      prisma.userProfile.findMany({
        where,
        include: { roles: { select: { id: true, name: true } } },
        orderBy: { [sortField]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.userProfile.count({ where }),
    ])

    return paginated(users, total, page, limit)
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
    const data = createUserSchema.parse(body)

    // Verificar se role pertence à mesma empresa
    const role = await prisma.role.findFirst({
      where: { id: data.roleId, company_id: admin.companyId },
    })
    if (!role) return error('Cargo não encontrado', 404)

    const supabaseAdmin = createAdminClient()

    // Criar no Supabase Auth (requer service_role key)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password || randomBytes(16).toString('base64url') + 'A1!',
      email_confirm: true,
      app_metadata: { company_id: admin.companyId, user_role: role.name.toLowerCase() },
    })

    if (authError || !authData.user) {
      return error(authError?.message ?? 'Erro ao criar usuário', 500)
    }

    const profile = await prisma.userProfile.create({
      data: {
        id: authData.user.id,
        company_id: admin.companyId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        role_id: data.roleId,
      },
      include: { roles: { select: { id: true, name: true } } },
    })

    logAudit({
      companyId: admin.companyId,
      userId: admin.id,
      module: 'core',
      action: 'create_user',
      entityId: profile.id,
      newValue: { name: data.name, email: data.email, roleId: data.roleId },
    })

    return success(profile, 201)
  } catch (err) {
    return handleError(err)
  }
}
