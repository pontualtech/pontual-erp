import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { clearHostnameCache } from '@/lib/hostname-resolver'
import { RESERVED_SUBDOMAINS } from '@/lib/reserved-subdomains'

// GET /api/admin/companies — Listar todas as empresas
export async function GET(req: NextRequest) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const url = req.nextUrl
    const page = Math.max(parseInt(url.searchParams.get('page') || '1'), 1)
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50'), 1), 200)
    const search = url.searchParams.get('search') || ''

    const where = search
      ? { OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { slug: { contains: search, mode: 'insensitive' as const } },
        ] }
      : {}

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        include: {
          _count: { select: { user_profiles: true, service_orders: true, customers: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.company.count({ where }),
    ])

    return paginated(companies, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/companies — Criar nova empresa (sem auto-setup)
export async function POST(req: NextRequest) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const body = await req.json()
    const { name, slug, logo, subdomain, custom_domain } = body

    if (!name || !slug) return error('Nome e slug são obrigatórios')
    if (!/^[a-z0-9-]+$/.test(slug)) return error('Slug deve conter apenas letras minúsculas, números e hífens')

    const existing = await prisma.company.findUnique({ where: { slug } })
    if (existing) return error('Slug já está em uso', 409)

    // Validate subdomain
    const sub = subdomain || slug
    if (sub) {
      if (RESERVED_SUBDOMAINS.includes(sub)) return error(`Subdomínio "${sub}" é reservado e não pode ser usado`)
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(sub)) return error('Subdomínio inválido')
      const existingSub = await prisma.company.findFirst({ where: { subdomain: sub } })
      if (existingSub) return error('Subdomínio já está em uso', 409)
    }

    const company = await prisma.company.create({
      data: {
        name,
        slug,
        subdomain: sub || null,
        custom_domain: custom_domain || null,
        logo: logo || null,
        settings: {},
      },
    })

    // Clear hostname cache so new subdomain resolves immediately
    if (sub) clearHostnameCache()

    return success(company, 201)
  } catch (err) {
    return handleError(err)
  }
}
