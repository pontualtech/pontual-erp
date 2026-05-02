import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createPortalToken } from '@/lib/portal-auth'
import { compare } from 'bcryptjs'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { randomInt } from 'crypto'
import { sendCompanyEmail } from '@/lib/send-email'

// Returned for every failure path that could be used to enumerate customers.
// The status code is 401 and the message does not distinguish "no such CPF"
// from "wrong password" or "no access row yet" — all paths look identical
// to an attacker trying to map which CPFs are registered in a tenant.
function generic401() {
  return NextResponse.json(
    { error: 'Credenciais invalidas. Confira CPF/CNPJ e senha.' },
    { status: 401 }
  )
}

function generateOtp(): string {
  return String(randomInt(100000, 999999))
}

function otpEmailHtml(code: string, customerName: string, companyName: string): string {
  return `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:24px;">
    <div style="background:#1e40af;border-radius:12px 12px 0 0;padding:20px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:18px;">${companyName}</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">Codigo de Verificacao</p>
    </div>
    <div style="background:white;padding:24px;border-radius:0 0 12px 12px;">
      <p style="color:#374151;font-size:14px;margin:0 0 16px;">Ola, <strong>${customerName}</strong>!</p>
      <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">Use o codigo abaixo para acessar o Portal do Cliente:</p>
      <div style="background:#eff6ff;border:2px solid #2563eb;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
        <p style="font-size:36px;font-weight:700;color:#1e40af;margin:0;letter-spacing:8px;font-family:monospace;">${code}</p>
      </div>
      <p style="color:#9ca3af;font-size:12px;margin:0 0 4px;">Este codigo expira em <strong>5 minutos</strong>.</p>
      <p style="color:#9ca3af;font-size:12px;margin:0;">Se voce nao solicitou este codigo, ignore este email.</p>
    </div>
    <div style="text-align:center;padding:12px;font-size:11px;color:#9ca3af;">Enviado por ${companyName} via PontualERP</div>
  </div>
</body></html>`
}

export async function POST(req: NextRequest) {
  try {
    // UX-10 #2: body vazio retornava 500 — agora 400 limpo
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body invalido' }, { status: 400 })
    }
    const { document, password, company_slug } = body

    if (!document || !password || !company_slug) {
      return NextResponse.json(
        { error: 'Documento, senha e empresa sao obrigatorios' },
        { status: 400 }
      )
    }

    const cleanDoc = document.replace(/[.\-\/]/g, '')

    // Rate limit #1: per document — blocks focused brute force against one CPF
    const rateLimitKey = `portal-auth:${cleanDoc}`
    const rl = rateLimit(rateLimitKey, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
        { status: 429 }
      )
    }

    // Rate limit #2: per IP — blocks enumeration attacks where the attacker
    // rotates the document each request to stay below the per-doc limit.
    const clientIp = getClientIp(req)
    const ipRl = rateLimit(`portal-auth-ip:${clientIp}`, 30, 15 * 60 * 1000)
    if (!ipRl.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
        { status: 429 }
      )
    }

    const company = await prisma.company.findUnique({
      where: { slug: company_slug },
    })

    if (!company) {
      // Slug malformed / unknown — this one IS safe to report since it only
      // reveals tenant existence, which is already public via the domain.
      return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })
    }

    const customer = await prisma.customer.findFirst({
      where: {
        company_id: company.id,
        document_number: cleanDoc,
        deleted_at: null,
      },
    })

    if (!customer) return generic401()

    const access = await prisma.customerAccess.findUnique({
      where: {
        company_id_customer_id: {
          company_id: company.id,
          customer_id: customer.id,
        },
      },
    })

    if (!access || !access.password_hash) return generic401()

    const isValidPassword = await compare(password, access.password_hash)
    if (!isValidPassword) return generic401()

    // --- 2FA: Generate OTP and send via email ---
    // Rate limit OTP generation: max 3 per hour per customer
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recentOtps = await prisma.loginOtp.count({
      where: {
        company_id: company.id,
        customer_id: customer.id,
        created_at: { gte: oneHourAgo },
      },
    })

    if (recentOtps >= 3) {
      return NextResponse.json(
        { error: 'Muitos codigos enviados. Tente novamente em 1 hora.' },
        { status: 429 }
      )
    }

    const otpCode = generateOtp()
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

    await prisma.loginOtp.create({
      data: {
        company_id: company.id,
        customer_id: customer.id,
        code: otpCode,
        expires_at: expiresAt,
      },
    })

    // Send OTP via email (fire-and-forget, but log failure)
    const customerEmail = customer.email
    if (customerEmail) {
      const firstName = customer.legal_name?.split(' ')[0] || 'Cliente'
      void sendCompanyEmail(
        company.id,
        customerEmail,
        `Codigo de verificacao - ${company.name}`,
        otpEmailHtml(otpCode, firstName, company.name)
      ).catch(err => console.error('[Portal OTP Email Error]', err))
    }

    // Mask email for hint
    const emailHint = customerEmail
      ? customerEmail.replace(/^(.{2}).*(@.*)$/, '$1***$2')
      : null

    return NextResponse.json({
      data: {
        requires_otp: true,
        customer_id: customer.id,
        company_id: company.id,
        email_hint: emailHint,
        message: 'Codigo de verificacao enviado para seu email.',
      },
    })
  } catch (err) {
    console.error('[Portal Auth Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
