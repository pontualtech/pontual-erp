import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

export async function POST(req: NextRequest) {
  try {
    const { token, company_slug } = await req.json()

    if (!token || !company_slug) {
      return NextResponse.json({ error: 'Token e empresa obrigatorios' }, { status: 400 })
    }

    const company = await prisma.company.findUnique({
      where: { slug: company_slug },
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })
    }

    const access = await prisma.customerAccess.findFirst({
      where: {
        company_id: company.id,
        verify_token: token,
      },
    })

    if (!access) {
      return NextResponse.json(
        { error: 'Link invalido ou expirado.' },
        { status: 404 }
      )
    }

    if (access.email_verified) {
      return NextResponse.json({
        data: { already_verified: true, message: 'Email ja foi verificado!' },
      })
    }

    await prisma.customerAccess.update({
      where: { id: access.id },
      data: {
        email_verified: true,
        verify_token: null,
      },
    })

    return NextResponse.json({
      data: { success: true, message: 'Email verificado com sucesso!' },
    })
  } catch (err) {
    console.error('[Portal Verify Email Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
