import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createPortalToken } from '@/lib/portal-auth'

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

    // Para MVP: senha = primeiros 5 digitos do documento
    const expectedPassword = cleanDoc.replace(/\D/g, '').substring(0, 5)

    if (password !== access.password_hash && password !== expectedPassword) {
      return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
    }

    // Atualizar ultimo login
    await prisma.customerAccess.update({
      where: { id: access.id },
      data: { last_login_at: new Date() },
    })

    // Criar token
    const token = createPortalToken(customer.id, company.id)

    const response = NextResponse.json({
      data: {
        token,
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
