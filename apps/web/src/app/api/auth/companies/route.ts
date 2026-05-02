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

    // UX-9 #2: shape padronizado {id, name, slug, logo, role} — antes era
    // {companyId, companyName, companySlug, companyLogo, role} que não batia
    // com CompanySwitcher (que esperava id/name/slug/logo).
    const companies = profiles
      .filter((p) => p.companies.is_active)
      .map((p) => ({
        id: p.companies.id,
        name: p.companies.name,
        slug: p.companies.slug,
        logo: p.companies.logo,
        role: p.roles.name,
        // Compat: mantém os campos antigos pra select-company/page.tsx
        companyId: p.companies.id,
        companyName: p.companies.name,
        companySlug: p.companies.slug,
        companyLogo: p.companies.logo,
      }))

    return success(companies)
  } catch (err) {
    return handleError(err)
  }
}
