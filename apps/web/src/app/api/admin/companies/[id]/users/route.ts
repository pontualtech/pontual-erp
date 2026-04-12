import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSuperAdmin } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { randomBytes } from 'crypto'

// GET /api/admin/companies/[id]/users — Listar usuários da empresa
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const company = await prisma.company.findUnique({ where: { id: params.id } })
    if (!company) return error('Empresa não encontrada', 404)

    const users = await prisma.userProfile.findMany({
      where: { company_id: params.id },
      include: { roles: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    })

    return success(users)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/companies/[id]/users — Criar usuário na empresa
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const company = await prisma.company.findUnique({ where: { id: params.id } })
    if (!company) return error('Empresa não encontrada', 404)

    const body = await req.json()
    const { name, email, phone, roleId, password } = body

    if (!name || !email || !roleId) return error('Nome, email e perfil são obrigatórios')

    // Verificar se role pertence a esta empresa
    const role = await prisma.role.findFirst({
      where: { id: roleId, company_id: params.id },
    })
    if (!role) return error('Perfil não encontrado nesta empresa', 404)

    // Verificar se email já existe nesta empresa
    const existingProfile = await prisma.userProfile.findFirst({
      where: { email, company_id: params.id },
    })
    if (existingProfile) return error('Já existe um usuário com este email nesta empresa', 409)

    const supabase = createAdminClient()

    // Gerar senha se não fornecida
    const userPassword = password || randomBytes(12).toString('base64url')

    // Verificar se o email já existe no Supabase Auth (cross-company)
    // Se sim, reusar o auth user existente e apenas criar novo perfil
    const { data: existingUsers } = await supabase.auth.admin.listUsers({ perPage: 1, page: 1 })
    let authUserId: string | null = null

    // Tentar buscar por email no auth
    const existingAuthProfile = await prisma.userProfile.findFirst({ where: { email } })
    if (existingAuthProfile) {
      // Usuário já existe em outra empresa — reusar o auth ID
      authUserId = existingAuthProfile.id
    }

    if (!authUserId) {
      // Criar novo usuário no Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password: userPassword,
        email_confirm: true,
        app_metadata: { company_id: params.id, user_role: role.name.toLowerCase() },
      })

      if (authError || !authData.user) {
        return error(authError?.message ?? 'Erro ao criar usuário no auth', 500)
      }
      authUserId = authData.user.id
    }

    // Criar perfil (pode ter o mesmo user ID em outra empresa — multi-company)
    let profile
    try {
      profile = await prisma.userProfile.create({
        data: {
          id: authUserId,
          company_id: params.id,
          name,
          email,
          phone: phone || null,
          role_id: roleId,
        },
      })
    } catch (profileErr) {
      // Se o profile falhou e criamos um auth user novo, limpar o orphan
      if (!existingAuthProfile) {
        await supabase.auth.admin.deleteUser(authUserId).catch(() => {})
      }
      throw profileErr
    }

    return success({
      ...profile,
      generatedPassword: !password && !existingAuthProfile ? userPassword : undefined,
      roleName: role.name,
    }, 201)
  } catch (err) {
    return handleError(err)
  }
}
