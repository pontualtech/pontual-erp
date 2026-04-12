import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'

// GET /api/admin/companies — Listar todas as empresas
export async function GET(req: NextRequest) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const url = req.nextUrl
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = parseInt(url.searchParams.get('limit') || '50')
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
    const { name, slug, logo } = body

    if (!name || !slug) return error('Nome e slug são obrigatórios')
    if (!/^[a-z0-9-]+$/.test(slug)) return error('Slug deve conter apenas letras minúsculas, números e hífens')

    const existing = await prisma.company.findUnique({ where: { slug } })
    if (existing) return error('Slug já está em uso', 409)

    const company = await prisma.company.create({
      data: { name, slug, logo: logo || null, settings: {} },
    })

    return success(company, 201)
  } catch (err) {
    return handleError(err)
  }
}
