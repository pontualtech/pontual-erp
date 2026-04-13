import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { hash } from 'bcryptjs'
import { sendCompanyEmail } from '@/lib/send-email'

// Rate limiter em memória: 5 tentativas por documento a cada 15 minutos
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 })
    return true
  }

  entry.count++
  if (entry.count > 5) {
    return false
  }

  return true
}

// Cleanup a cada 5 minutos
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, val] of rateLimitMap) {
      if (val.resetAt < now) rateLimitMap.delete(key)
    }
  }, 5 * 60 * 1000)
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const first = local[0]
  const last = local.length > 1 ? local[local.length - 1] : ''
  return `${first}***${last}@${domain}`
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

    // Rate limiting por documento
    if (!checkRateLimit(`recuperar-senha:${cleanDoc}`)) {
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
        { error: 'Acesso nao cadastrado. Faca seu primeiro acesso na pagina de registro.' },
        { status: 404 }
      )
    }

    // Gerar nova senha = 5 primeiros digitos do documento
    const newPassword = cleanDoc.slice(0, 5)
    const password_hash = await hash(newPassword, 10)

    // Atualizar senha
    await prisma.customerAccess.update({
      where: { id: access.id },
      data: { password_hash },
    })

    // Se cliente tem email, envia notificacao
    let emailHint: string | null = null
    if (customer.email) {
      emailHint = maskEmail(customer.email)

      await sendCompanyEmail(
        company.id,
        customer.email,
        'Senha Resetada - Portal do Cliente',
        `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #1e40af;">Senha Resetada</h2>
          <p>Ola, <strong>${customer.legal_name || customer.trade_name || 'Cliente'}</strong>!</p>
          <p>Sua senha do Portal do Cliente foi resetada com sucesso.</p>
          <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0; color: #1e40af;">
              <strong>Sua nova senha:</strong> os 5 primeiros digitos do seu CPF/CNPJ
            </p>
          </div>
          <p style="color: #6b7280; font-size: 14px;">
            Recomendamos que troque sua senha no primeiro acesso para maior seguranca.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">
            ${company.name} - Portal do Cliente
          </p>
        </div>
        `
      )
    }

    return NextResponse.json({
      success: true,
      email_hint: emailHint,
      message: 'Senha resetada! Use os 5 primeiros digitos do seu CPF/CNPJ.',
    })
  } catch (err) {
    console.error('[Portal Recuperar Senha Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
