import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createClient } from '@/lib/supabase/server'
import { requireSuperAdmin } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

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

    // Verificar se email já existe
    const existingProfile = await prisma.userProfile.findFirst({
      where: { email, company_id: params.id },
    })
    if (existingProfile) return error('Já existe um usuário com este email nesta empresa', 409)

    const supabase = createClient()

    // Gerar senha se não fornecida
    const userPassword = password || Math.random().toString(36).slice(-10) + 'A1!'

    // Criar no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: userPassword,
      email_confirm: true,
      app_metadata: { company_id: params.id, user_role: role.name.toLowerCase() },
    })

    if (authError || !authData.user) {
      return error(authError?.message ?? 'Erro ao criar usuário no auth', 500)
    }

    // Criar perfil
    const profile = await prisma.userProfile.create({
      data: {
        id: authData.user.id,
        company_id: params.id,
        name,
        email,
        phone: phone || null,
        role_id: roleId,
      },
    })

    return success({
      ...profile,
      generatedPassword: !password ? userPassword : undefined,
      roleName: role.name,
    }, 201)
  } catch (err) {
    return handleError(err)
  }
}
