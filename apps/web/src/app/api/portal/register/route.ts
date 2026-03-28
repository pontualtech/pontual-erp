import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***@***'
  const masked = local[0] + '***' + (local.length > 1 ? local[local.length - 1] : '')
  return `${masked}@${domain}`
}

function maskName(name: string): string {
  return name
    .split(' ')
    .map(part => {
      if (part.length <= 2) return part
      return part[0] + '***' + part[part.length - 1]
    })
    .join(' ')
}

export async function POST(req: NextRequest) {
  try {
    const { document, company_slug } = await req.json()

    if (!document || !company_slug) {
      return NextResponse.json(
        { error: 'Documento e empresa sao obrigatorios' },
        { status: 400 }
      )
    }

    const cleanDoc = document.replace(/[.\-\/]/g, '')

    // Encontrar empresa
    const company = await prisma.company.findUnique({
      where: { slug: company_slug },
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })
    }

    // Encontrar cliente
    const customer = await prisma.customer.findFirst({
      where: {
        company_id: company.id,
        document_number: cleanDoc,
        deleted_at: null,
      },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Cliente nao encontrado. Verifique o CPF/CNPJ informado.' },
        { status: 404 }
      )
    }

    // Verificar se ja tem acesso
    const existingAccess = await prisma.customerAccess.findUnique({
      where: {
        company_id_customer_id: {
          company_id: company.id,
          customer_id: customer.id,
        },
      },
    })

    if (existingAccess) {
      return NextResponse.json(
        { error: 'Voce ja possui acesso cadastrado. Faca login.' },
        { status: 409 }
      )
    }

    // Senha padrao = primeiros 5 digitos do documento
    const defaultPassword = cleanDoc.replace(/\D/g, '').substring(0, 5)

    // Criar acesso
    await prisma.customerAccess.create({
      data: {
        company_id: company.id,
        customer_id: customer.id,
        password_hash: defaultPassword,
        email_verified: false,
        verify_token: crypto.randomUUID(),
      },
    })

    // TODO: Enviar email de verificacao quando tiver SMTP configurado

    return NextResponse.json({
      data: {
        success: true,
        customer_name: maskName(customer.legal_name),
        email_hint: customer.email ? maskEmail(customer.email) : null,
        message: 'Acesso criado com sucesso! Sua senha inicial sao os 5 primeiros digitos do seu CPF/CNPJ.',
      },
    })
  } catch (err) {
    console.error('[Portal Register Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
