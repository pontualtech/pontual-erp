import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { hash } from 'bcryptjs'
import { sendCompanyEmail } from '@/lib/send-email'

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

    // Senha aleatória segura (8 chars alfanuméricos)
    const { randomBytes } = await import('crypto')
    const pwChars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    const bytes = randomBytes(8)
    const defaultPassword = Array.from(bytes, (b) => pwChars[b % pwChars.length]).join('')
    const passwordHash = await hash(defaultPassword, 10)

    const verifyToken = crypto.randomUUID()

    // Criar acesso
    await prisma.customerAccess.create({
      data: {
        company_id: company.id,
        customer_id: customer.id,
        password_hash: passwordHash,
        email_verified: false,
        verify_token: verifyToken,
      },
    })

    // Enviar email de boas-vindas com instrucoes
    if (customer.email) {
      const firstName = customer.legal_name?.split(' ')[0] || 'Cliente'
      const portalBase = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
      const verifyUrl = `${portalBase}/portal/${company.slug}/verificar-email?token=${verifyToken}`
      const loginUrl = `${portalBase}/portal/${company.slug}/login?doc=${cleanDoc}`

      void sendCompanyEmail(
        company.id,
        customer.email,
        `Bem-vindo ao Portal do Cliente - ${company.name}`,
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:24px;">
    <div style="background:#1e40af;border-radius:12px 12px 0 0;padding:20px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:18px;">${company.name}</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">Portal do Cliente</p>
    </div>
    <div style="background:white;padding:24px;border-radius:0 0 12px 12px;">
      <p style="color:#374151;font-size:14px;">Ola, <strong>${firstName}</strong>!</p>
      <p style="color:#6b7280;font-size:14px;">Seu acesso ao Portal do Cliente foi ativado.</p>
      <div style="background:#eff6ff;border:2px solid #2563eb;border-radius:12px;padding:16px;margin:16px 0;text-align:center;">
        <p style="color:#6b7280;font-size:12px;margin:0 0 4px;">Sua senha inicial:</p>
        <p style="font-size:28px;font-weight:700;color:#1e40af;margin:0;letter-spacing:4px;font-family:monospace;">${defaultPassword}</p>
        <p style="color:#9ca3af;font-size:11px;margin:4px 0 0;">(5 primeiros digitos do seu CPF/CNPJ)</p>
      </div>
      <div style="text-align:center;margin:20px 0;">
        <a href="${loginUrl}" style="display:inline-block;padding:12px 32px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Acessar Portal</a>
      </div>
      <p style="color:#9ca3af;font-size:11px;margin:16px 0 0;">Recomendamos trocar sua senha no primeiro acesso.</p>
    </div>
  </div>
</body></html>`
      ).catch(err => console.error('[Portal Register Email Error]', err))
    }

    return NextResponse.json({
      data: {
        success: true,
        customer_name: maskName(customer.legal_name),
        email_hint: customer.email ? maskEmail(customer.email) : null,
        message: 'Acesso criado com sucesso! Sua senha sao os 5 primeiros digitos do seu CPF/CNPJ.',
      },
    })
  } catch (err) {
    console.error('[Portal Register Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
