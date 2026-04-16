import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { hash } from 'bcryptjs'
import { sendCompanyEmail } from '@/lib/send-email'
import { escapeHtml } from '@/lib/escape-html'

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

    // Check duplicates: document, email, phone
    const cleanPhone = phone.replace(/\D/g, '')
    const cleanEmail = email.trim().toLowerCase()

    const existingByDoc = await prisma.customer.findFirst({
      where: { company_id: company.id, document_number: cleanDoc, deleted_at: null },
    })
    if (existingByDoc) {
      return NextResponse.json(
        { error: 'CPF/CNPJ ja cadastrado. Faca login ou recupere sua senha.' },
        { status: 409 }
      )
    }

    const existingByEmail = await prisma.customer.findFirst({
      where: { company_id: company.id, email: cleanEmail, deleted_at: null },
    })
    if (existingByEmail) {
      return NextResponse.json(
        { error: 'Este email ja esta cadastrado para outro cliente.' },
        { status: 409 }
      )
    }

    if (cleanPhone.length >= 10) {
      const existingByPhone = await prisma.customer.findFirst({
        where: {
          company_id: company.id, deleted_at: null,
          OR: [
            { mobile: { contains: cleanPhone.slice(-10) } },
            { phone: { contains: cleanPhone.slice(-10) } },
          ],
        },
      })
      if (existingByPhone) {
        return NextResponse.json(
          { error: 'Este telefone ja esta cadastrado para outro cliente.' },
          { status: 409 }
        )
      }
    }

    // Format data
    const { formatName, formatEmail, formatPhone } = await import('@/lib/format-text')
    const formattedName = formatName(legal_name)
    const formattedEmail = formatEmail(email)
    const formattedPhone = formatPhone(phone)

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
          address_street: address_street ? formatName(address_street) : null,
          address_number: address_number?.trim() || null,
          address_complement: address_complement ? formatName(address_complement) : null,
          address_neighborhood: address_neighborhood ? formatName(address_neighborhood) : null,
          address_city: address_city ? formatName(address_city) : null,
          address_state: address_state?.trim().toUpperCase() || null,
        },
      })

      const verifyToken = crypto.randomUUID()
      await tx.customerAccess.create({
        data: {
          company_id: company.id,
          customer_id: customer.id,
          password_hash: passwordHash,
          email_verified: false,
          verify_token: verifyToken,
        },
      })

      return { customer, verifyToken }
    })

    // Send verification email (fire-and-forget)
    if (formattedEmail && result.verifyToken) {
      const verifyUrl = `${process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'}/portal/${company_slug}/verificar-email?token=${result.verifyToken}`
      const firstName = formattedName.split(' ')[0] || 'Cliente'
      void sendCompanyEmail(
        company.id,
        formattedEmail,
        `Verifique seu email - ${company.name}`,
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:24px;">
    <div style="background:#1e40af;border-radius:12px 12px 0 0;padding:20px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:18px;">${escapeHtml(company.name)}</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">Verificacao de Email</p>
    </div>
    <div style="background:white;padding:24px;border-radius:0 0 12px 12px;">
      <p style="color:#374151;font-size:14px;margin:0 0 16px;">Ola, <strong>${escapeHtml(firstName)}</strong>! Bem-vindo ao Portal do Cliente.</p>
      <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">Clique no botao abaixo para verificar seu email:</p>
      <div style="text-align:center;margin:0 0 20px;">
        <a href="${verifyUrl}" style="display:inline-block;padding:12px 32px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Verificar Email</a>
      </div>
      <p style="color:#9ca3af;font-size:12px;margin:0;">Se voce nao criou esta conta, ignore este email.</p>
    </div>
  </div>
</body></html>`
      ).catch(err => console.error('[Portal Cadastro Email Error]', err))
    }

    return NextResponse.json({
      data: {
        success: true,
        customer_id: result.customer.id,
        email_hint: maskEmail(formattedEmail),
        message: 'Conta criada com sucesso! Verifique seu email para ativar.',
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
