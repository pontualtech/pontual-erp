import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createPortalToken } from '@/lib/portal-auth'
import { compare } from 'bcryptjs'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  try {
    const { document, password, company_slug } = await req.json()

    if (!document || !password || !company_slug) {
      return NextResponse.json(
        { error: 'Documento, senha e empresa sao obrigatorios' },
        { status: 400 }
      )
    }

    // Limpar documento (remover pontos, tracos, barras)
    const cleanDoc = document.replace(/[.\-\/]/g, '')

    // Rate limiting: 5 tentativas por documento a cada 15 minutos
    const rateLimitKey = `portal-auth:${cleanDoc}`
    const rl = rateLimit(rateLimitKey, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
        { status: 429 }
      )
    }

    // Encontrar empresa pelo slug
    const company = await prisma.company.findUnique({
      where: { slug: company_slug },
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })
    }

    // Encontrar cliente pelo documento
    const customer = await prisma.customer.findFirst({
      where: {
        company_id: company.id,
        document_number: cleanDoc,
        deleted_at: null,
      },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Cliente nao encontrado. Verifique o CPF/CNPJ.' },
        { status: 404 }
      )
    }

    // Verificar se tem acesso cadastrado
    const access = await prisma.customerAccess.findUnique({
      where: {
        company_id_customer_id: {
          company_id: company.id,
          customer_id: customer.id,
        },
      },
    })

    if (!access) {
      return NextResponse.json(
        { error: 'Acesso nao cadastrado. Faca seu primeiro acesso.' },
        { status: 403 }
      )
    }

    // Verificar senha com bcrypt (sem fallback inseguro)
    if (!access.password_hash) {
      return NextResponse.json({ error: 'Senha nao configurada. Entre em contato com a empresa.' }, { status: 401 })
    }

    const isValidPassword = await compare(password, access.password_hash)
    if (!isValidPassword) {
      return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
    }

    // Atualizar ultimo login
    await prisma.customerAccess.update({
      where: { id: access.id },
      data: { last_login_at: new Date() },
    })

    // Criar token
    const token = createPortalToken(customer.id, company.id)

    // Token is only sent via httpOnly cookie, never in the response body
    const response = NextResponse.json({
      data: {
        customer: {
          id: customer.id,
          name: customer.legal_name,
        },
        company: {
          id: company.id,
          name: company.name,
          slug: company.slug,
        },
      },
    })

    // Setar cookie
    response.cookies.set('portal_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    })

    return response
  } catch (err) {
    console.error('[Portal Auth Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
