import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { hash } from 'bcryptjs'

// Simple in-memory rate limiter: 3 registrations per IP per hour
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 })
    return true
  }

  if (entry.count >= 3) return false
  entry.count++
  return true
}

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key)
  }
}, 10 * 60 * 1000)

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***@***'
  const masked = local[0] + '***' + (local.length > 1 ? local[local.length - 1] : '')
  return `${masked}@${domain}`
}

export async function POST(req: NextRequest) {
  try {
    // Rate limiting by IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown'

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Tente novamente em 1 hora.' },
        { status: 429 }
      )
    }

    const body = await req.json()
    const {
      company_slug,
      document_number,
      person_type,
      legal_name,
      email,
      phone,
      password,
      address_zip,
      address_street,
      address_number,
      address_complement,
      address_neighborhood,
      address_city,
      address_state,
    } = body

    // Validate required fields
    if (!company_slug || !document_number || !legal_name || !email || !phone || !password) {
      return NextResponse.json(
        { error: 'Preencha todos os campos obrigatorios' },
        { status: 400 }
      )
    }

    // Validate document length
    const cleanDoc = document_number.replace(/\D/g, '')
    if (cleanDoc.length !== 11 && cleanDoc.length !== 14) {
      return NextResponse.json(
        { error: 'CPF ou CNPJ invalido' },
        { status: 400 }
      )
    }

    // Validate email
    if (!email.includes('@') || !email.includes('.')) {
      return NextResponse.json(
        { error: 'Email invalido' },
        { status: 400 }
      )
    }

    // Validate password
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'A senha deve ter pelo menos 6 caracteres' },
        { status: 400 }
      )
    }

    // Find company by slug
    const company = await prisma.company.findUnique({
      where: { slug: company_slug },
    })

    if (!company) {
      return NextResponse.json(
        { error: 'Empresa nao encontrada' },
        { status: 404 }
      )
    }

    // Check if document already exists for this company
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        company_id: company.id,
        document_number: cleanDoc,
        deleted_at: null,
      },
    })

    if (existingCustomer) {
      return NextResponse.json(
        { error: 'CPF/CNPJ ja cadastrado. Faca login ou recupere sua senha.' },
        { status: 409 }
      )
    }

    // Format data
    const formattedName = legal_name.trim().toUpperCase()
    const formattedEmail = email.trim().toLowerCase()
    const formattedPhone = phone.replace(/\D/g, '')

    // Hash password
    const passwordHash = await hash(password, 10)

    // Create Customer + CustomerAccess in transaction
    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          company_id: company.id,
          legal_name: formattedName,
          person_type: person_type === 'JURIDICA' ? 'JURIDICA' : 'FISICA',
          customer_type: 'CLIENTE',
          document_number: cleanDoc,
          email: formattedEmail,
          phone: formattedPhone,
          mobile: formattedPhone,
          address_zip: address_zip?.replace(/\D/g, '') || null,
          address_street: address_street?.trim().toUpperCase() || null,
          address_number: address_number?.trim() || null,
          address_complement: address_complement?.trim().toUpperCase() || null,
          address_neighborhood: address_neighborhood?.trim().toUpperCase() || null,
          address_city: address_city?.trim().toUpperCase() || null,
          address_state: address_state?.trim().toUpperCase() || null,
        },
      })

      await tx.customerAccess.create({
        data: {
          company_id: company.id,
          customer_id: customer.id,
          password_hash: passwordHash,
          email_verified: false,
          verify_token: crypto.randomUUID(),
        },
      })

      return customer
    })

    return NextResponse.json({
      data: {
        success: true,
        email_hint: maskEmail(formattedEmail),
        message: 'Conta criada com sucesso! Faca login para acessar o portal.',
      },
    })
  } catch (err) {
    console.error('[Portal Cadastro Error]', err)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}
