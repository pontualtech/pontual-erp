import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

// GET /api/admin/companies/[id] — Detalhes da empresa
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const company = await prisma.company.findUnique({
      where: { id: params.id },
      include: {
        _count: { select: { user_profiles: true, service_orders: true, customers: true, roles: true } },
        roles: { orderBy: { name: 'asc' }, select: { id: true, name: true, is_system: true, is_active: true } },
        user_profiles: {
          orderBy: { name: 'asc' },
          select: { id: true, name: true, email: true, phone: true, is_active: true, role_id: true, created_at: true, roles: { select: { name: true } } },
        },
      },
    })

    if (!company) return error('Empresa não encontrada', 404)

    return success(company)
  } catch (err) {
    return handleError(err)
  }
}

// PATCH /api/admin/companies/[id] — Atualizar empresa
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const body = await req.json()
    const { name, logo, is_active, settings } = body

    const existing = await prisma.company.findUnique({ where: { id: params.id } })
    if (!existing) return error('Empresa não encontrada', 404)

    const data: Record<string, unknown> = {}
    if (name !== undefined) data.name = name
    if (logo !== undefined) data.logo = logo
    if (is_active !== undefined) data.is_active = is_active
    if (settings !== undefined) data.settings = settings
    data.updated_at = new Date()

    const company = await prisma.company.update({ where: { id: params.id }, data })

    return success(company)
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/admin/companies/[id] — Desativar empresa (soft delete)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const existing = await prisma.company.findUnique({ where: { id: params.id } })
    if (!existing) return error('Empresa não encontrada', 404)

    const company = await prisma.company.update({
      where: { id: params.id },
      data: { is_active: false, updated_at: new Date() },
    })

    return success(company)
  } catch (err) {
    return handleError(err)
  }
}
