import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

export async function GET(req: NextRequest) {
  try {
    const slug = req.nextUrl.searchParams.get('slug')

    if (!slug) {
      return NextResponse.json({ error: 'Slug e obrigatorio' }, { status: 400 })
    }

    const company = await prisma.company.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
      },
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })
    }

    return NextResponse.json({ data: company })
  } catch (err) {
    console.error('[Portal Company Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
