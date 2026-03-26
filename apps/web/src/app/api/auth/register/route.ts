import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@pontual/db'
import { registerSchema } from '@pontual/utils/validation'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('core', 'create')
    if (result instanceof NextResponse) return result
    const admin = result

    const body = await request.json()
    const data = registerSchema.parse(body)

    // Verificar se slug já existe
    const existing = await prisma.company.findUnique({ where: { slug: data.companySlug } })
    if (existing) {
      return error('Slug de empresa já está em uso', 409)
    }

    const supabase = createClient()

    // Criar usuário no Supabase Auth (admin API)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      app_metadata: { user_role: 'admin' },
    })

    if (authError || !authData.user) {
      return error(authError?.message ?? 'Erro ao criar usuário', 500)
    }

    // Criar empresa, role admin e perfil em transação
    const result2 = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: data.companyName, slug: data.companySlug },
      })

      const role = await tx.role.create({
        data: { company_id: company.id, name: 'Admin', description: 'Administrador com acesso total', is_system: true },
      })

      const profile = await tx.userProfile.create({
        data: {
          id: authData.user.id,
          company_id: company.id,
          name: data.name,
          email: data.email,
          phone: data.phone,
          role_id: role.id,
        },
      })

      // Atualizar metadata com company_id
      await supabase.auth.admin.updateUserById(authData.user.id, {
        app_metadata: { company_id: company.id, user_role: 'admin' },
      })

      return { company, profile }
    })

    logAudit({
      companyId: result2.company.id,
      userId: admin.id,
      module: 'core',
      action: 'register_company',
      entityId: result2.company.id,
      newValue: { companyName: data.companyName, email: data.email },
    })

    return success({ company: result2.company, user: result2.profile }, 201)
  } catch (err) {
    return handleError(err)
  }
}
