import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { hash } from 'bcryptjs'
import { sendCompanyEmail } from '@/lib/send-email'
import { escapeHtml } from '@/lib/escape-html'

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

    // Generate cryptographically secure random password (8 chars alphanumeric)
    const { randomBytes } = await import('crypto')
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    const bytes = randomBytes(8)
    const newPassword = Array.from(bytes, (b) => chars[b % chars.length]).join('')
    const password_hash = await hash(newPassword, 10)

    // Atualizar senha
    await prisma.customerAccess.update({
      where: { id: access.id },
      data: { password_hash },
    })

    // Se cliente tem email, envia a nova senha
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
          <p>Ola, <strong>${escapeHtml(customer.legal_name || customer.trade_name || 'Cliente')}</strong>!</p>
          <p>Sua senha do Portal do Cliente foi resetada com sucesso.</p>
          <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0; color: #1e40af;">
              <strong>Sua nova senha temporaria:</strong> <code style="font-size: 18px; letter-spacing: 2px;">${newPassword}</code>
            </p>
          </div>
          <p style="color: #6b7280; font-size: 14px;">
            Recomendamos que troque sua senha no primeiro acesso para maior seguranca.
          </p>
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;margin:24px 0;text-align:center;">
            <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0369a1;">🔐 Acesse o Portal do Cliente</p>
            <a href="${process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'}/portal/${company.slug}/login" style="display:inline-block;padding:10px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Ir para o Portal</a>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">
            ${escapeHtml(company.name)} - Portal do Cliente
          </p>
        </div>
        `
      )
    }

    return NextResponse.json({
      success: true,
      email_hint: emailHint,
      message: emailHint
        ? `Senha resetada! Uma nova senha temporaria foi enviada para ${emailHint}.`
        : 'Senha resetada! Nao encontramos um email cadastrado. Entre em contato com o suporte para receber sua nova senha.',
    })
  } catch (err) {
    console.error('[Portal Recuperar Senha Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
