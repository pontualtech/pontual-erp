import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

/**
 * UX-9 #1: Endpoint que estava AUSENTE em produção quebrando UX-7 #3
 * (CompanySwitcher inline header).
 *
 * Recebe { companyId }, valida que o usuário tem profile ativo na empresa
 * target, e seta cookie `active_company_id` httpOnly. O `getServerUser`
 * lê esse cookie pra resolver `companyId` em todas as queries (multi-tenant).
 *
 * Segurança:
 *  - Auth obrigatória
 *  - Valida profile.is_active=true E profile.company_id=target
 *  - Cookie httpOnly + sameSite + secure em prod
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser()
    if (!user) return error('Não autenticado', 401)

    const body = await req.json().catch(() => null)
    const companyId = body?.companyId
    if (!companyId || typeof companyId !== 'string') {
      return error('companyId obrigatório', 400)
    }

    // Validação crítica: user deve ter profile ATIVO na empresa target
    const profile = await prisma.userProfile.findFirst({
      where: {
        id: user.id,
        company_id: companyId,
        is_active: true,
      },
      include: { companies: { select: { id: true, name: true, slug: true } } },
    })

    if (!profile) {
      return error('Você não tem acesso a essa empresa', 403)
    }

    // Seta cookie httpOnly que sobrescreve hostname-based resolution
    const cookieStore = cookies()
    cookieStore.set('active_company_id', companyId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 dias
    })

    return success({
      company: profile.companies,
      message: `Trocado para ${profile.companies.name}`,
    })
  } catch (err) {
    return handleError(err)
  }
}
