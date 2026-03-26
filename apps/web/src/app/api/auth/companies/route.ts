import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return error('Não autenticado', 401)
    }

    // Buscar todas as empresas onde o usuário tem perfil ativo
    const profiles = await prisma.userProfile.findMany({
      where: { id: user.id, is_active: true },
      include: {
        companies: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            is_active: true,
          },
        },
        roles: {
          select: { id: true, name: true },
        },
      },
      orderBy: { companies: { name: 'asc' } },
    })

    const companies = profiles
      .filter((p) => p.companies.is_active)
      .map((p) => ({
        companyId: p.companies.id,
        companyName: p.companies.name,
        companySlug: p.companies.slug,
        companyLogo: p.companies.logo,
        role: p.roles.name,
      }))

    return success(companies)
  } catch (err) {
    return handleError(err)
  }
}
