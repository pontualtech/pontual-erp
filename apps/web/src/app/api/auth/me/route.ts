import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth'
import { prisma } from '@pontual/db'

export async function GET() {
  try {
    const user = await getServerUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    // Fetch role permissions so the frontend can do proper RBAC
    const profile = await prisma.userProfile.findFirst({
      where: { id: user.id, company_id: user.companyId },
      include: {
        roles: {
          include: {
            role_permissions: {
              include: { permissions: true },
              where: { granted: true },
            },
          },
        },
      },
    })

    const permissions = profile?.roles.role_permissions.map(rp => ({
      module: rp.permissions.module,
      action: rp.permissions.action,
    })) ?? []

    return NextResponse.json({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.roleName,
        companyId: user.companyId,
        permissions,
      },
    })
  } catch (err) {
    console.error('[auth/me] Error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
