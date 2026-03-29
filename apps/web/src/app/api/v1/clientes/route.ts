import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateApiKey, checkApiPermission, type ApiKeyUser } from '@/lib/api-key-auth'
import { createCustomerSchema, normalizeDocument } from '@/lib/validations/clientes'
import { ZodError } from 'zod'

/**
 * GET /api/v1/clientes — Listar clientes
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await authenticateApiKey(req)
    if (authResult instanceof NextResponse) return authResult
    const user = authResult as ApiKeyUser

    const permError = checkApiPermission(user, 'clientes:read')
    if (permError) return permError

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, Number(url.get('limit') || '20')))
    const search = url.get('search') || ''
    const personType = url.get('person_type') || null

    const where: any = {
      company_id: user.companyId,
      deleted_at: null,
    }

    if (personType) {
      const personTypeMap: Record<string, string> = { PF: 'FISICA', PJ: 'JURIDICA', FISICA: 'FISICA', JURIDICA: 'JURIDICA' }
      where.person_type = personTypeMap[personType] || personType
    }

    if (search) {
      where.OR = [
        { legal_name: { contains: search, mode: 'insensitive' } },
        { trade_name: { contains: search, mode: 'insensitive' } },
        { document_number: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { legal_name: 'asc' },
      }),
      prisma.customer.count({ where }),
    ])

    return NextResponse.json({ data, total, page, limit })
  } catch (err) {
    console.error('[API v1 Clientes GET]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

/**
 * POST /api/v1/clientes — Criar cliente
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateApiKey(req)
    if (authResult instanceof NextResponse) return authResult
    const user = authResult as ApiKeyUser

    const permError = checkApiPermission(user, 'clientes:write')
    if (permError) return permError

    const body = await req.json()
    const data = createCustomerSchema.parse(body)

    // Normalizar documento
    const docDigits = data.document_number ? normalizeDocument(data.document_number) : null

    // Verificar duplicata por documento
    if (docDigits && docDigits.length >= 11) {
      const existing = await prisma.customer.findFirst({
        where: { company_id: user.companyId, deleted_at: null, document_number: docDigits },
      })
      if (existing) {
        return NextResponse.json(
          { error: 'Cliente já cadastrado com este CPF/CNPJ', existing: { id: existing.id } },
          { status: 409 }
        )
      }
    }

    const customer = await prisma.customer.create({
      data: {
        company_id: user.companyId,
        ...data,
        document_number: docDigits || data.document_number,
      },
    })

    return NextResponse.json({ data: customer }, { status: 201 })
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Dados inválidos', details: err.errors }, { status: 422 })
    }
    console.error('[API v1 Clientes POST]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
