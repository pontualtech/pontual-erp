import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

export async function POST(req: NextRequest) {
  try {
    const { document, company_slug } = await req.json()

    if (!document || !company_slug) {
      return NextResponse.json({ error: 'Documento e empresa obrigatorios' }, { status: 400 })
    }

    const cleanDoc = document.replace(/\D/g, '')
    if (cleanDoc.length !== 11 && cleanDoc.length !== 14) {
      return NextResponse.json({ error: 'CPF ou CNPJ invalido' }, { status: 400 })
    }

    const company = await prisma.company.findUnique({
      where: { slug: company_slug },
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })
    }

    // Check if customer exists in ERP
    const customer = await prisma.customer.findFirst({
      where: {
        company_id: company.id,
        document_number: cleanDoc,
        deleted_at: null,
      },
      select: {
        id: true,
        legal_name: true,
        email: true,
      },
    })

    if (!customer) {
      return NextResponse.json({
        data: { exists: false, has_access: false },
      })
    }

    // Customer exists — check if has portal access
    const access = await prisma.customerAccess.findUnique({
      where: {
        company_id_customer_id: {
          company_id: company.id,
          customer_id: customer.id,
        },
      },
      select: { id: true, email_verified: true },
    })

    // Mask email for hint
    const emailHint = customer.email
      ? customer.email.replace(/^(.{2}).*(@.*)$/, '$1***$2')
      : null

    return NextResponse.json({
      data: {
        exists: true,
        has_access: !!access,
        email_verified: access?.email_verified || false,
        customer_name: customer.legal_name?.split(' ')[0] || 'Cliente',
        email_hint: emailHint,
      },
    })
  } catch (err) {
    console.error('[Portal Check Document Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
