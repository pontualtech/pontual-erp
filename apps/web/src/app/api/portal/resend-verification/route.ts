import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { sendEmail } from '@/lib/send-email'

export async function POST(req: NextRequest) {
  try {
    const { customer_id, company_slug } = await req.json()

    if (!customer_id || !company_slug) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
    }

    const company = await prisma.company.findUnique({
      where: { slug: company_slug },
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })
    }

    const access = await prisma.customerAccess.findFirst({
      where: { company_id: company.id, customer_id },
    })

    if (!access) {
      return NextResponse.json({ error: 'Acesso nao encontrado' }, { status: 404 })
    }

    if (access.email_verified) {
      return NextResponse.json({ data: { already_verified: true } })
    }

    // Generate new token
    const newToken = crypto.randomUUID()
    await prisma.customerAccess.update({
      where: { id: access.id },
      data: { verify_token: newToken },
    })

    // Get customer email
    const customer = await prisma.customer.findUnique({
      where: { id: customer_id },
      select: { email: true, legal_name: true },
    })

    if (!customer?.email) {
      return NextResponse.json({ error: 'Email nao cadastrado' }, { status: 400 })
    }

    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'}/portal/${company.slug}/verificar-email?token=${newToken}`
    const firstName = customer.legal_name?.split(' ')[0] || 'Cliente'

    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:24px;">
    <div style="background:#1e40af;border-radius:12px 12px 0 0;padding:20px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:18px;">${company.name}</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">Verificacao de Email</p>
    </div>
    <div style="background:white;padding:24px;border-radius:0 0 12px 12px;">
      <p style="color:#374151;font-size:14px;margin:0 0 16px;">Ola, <strong>${firstName}</strong>!</p>
      <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">Clique no botao abaixo para verificar seu email:</p>
      <div style="text-align:center;margin:0 0 20px;">
        <a href="${verifyUrl}" style="display:inline-block;padding:12px 32px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
          Verificar Email
        </a>
      </div>
      <p style="color:#9ca3af;font-size:12px;margin:0;">Se voce nao criou esta conta, ignore este email.</p>
    </div>
    <div style="text-align:center;padding:12px;font-size:11px;color:#9ca3af;">Enviado por ${company.name} via PontualERP</div>
  </div>
</body></html>`

    await sendEmail(customer.email, `Verifique seu email - ${company.name}`, html)

    return NextResponse.json({
      data: { success: true, message: 'Email de verificacao reenviado!' },
    })
  } catch (err) {
    console.error('[Portal Resend Verification Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
