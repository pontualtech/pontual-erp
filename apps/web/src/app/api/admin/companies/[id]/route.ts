import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { clearHostnameCache } from '@/lib/hostname-resolver'

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
    const { name, logo, is_active, settings, subdomain, custom_domain } = body

    const existing = await prisma.company.findUnique({ where: { id: params.id } })
    if (!existing) return error('Empresa não encontrada', 404)

    // Validate subdomain uniqueness if changing
    if (subdomain !== undefined && subdomain !== existing.subdomain) {
      if (subdomain) {
        const dup = await prisma.company.findFirst({ where: { subdomain, id: { not: params.id } } })
        if (dup) return error('Subdomínio já está em uso por outra empresa', 409)
      }
    }

    // Validate custom_domain uniqueness if changing
    if (custom_domain !== undefined && custom_domain !== existing.custom_domain) {
      if (custom_domain) {
        const dup = await prisma.company.findFirst({ where: { custom_domain, id: { not: params.id } } })
        if (dup) return error('Domínio customizado já está em uso por outra empresa', 409)
      }
    }

    const data: Record<string, unknown> = {}
    if (name !== undefined) data.name = name
    if (logo !== undefined) data.logo = logo
    if (is_active !== undefined) data.is_active = is_active
    if (settings !== undefined) data.settings = settings
    if (subdomain !== undefined) data.subdomain = subdomain || null
    if (custom_domain !== undefined) data.custom_domain = custom_domain || null
    data.updated_at = new Date()

    const company = await prisma.company.update({ where: { id: params.id }, data })

    // Clear hostname cache if domain config changed
    if (subdomain !== undefined || custom_domain !== undefined) {
      clearHostnameCache()
    }

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
