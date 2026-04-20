import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { rateLimit } from '@/lib/rate-limit'
import { randomInt } from 'crypto'
import { sendWhatsAppTemplate, sendWhatsAppCloud } from '@/lib/whatsapp/cloud-api'

function generateOtp(): string {
  return String(randomInt(100000, 999999))
}

// Normalize Brazilian phone: strips formatting, adds 55 country code if missing
// Keeps only digits, returns format "5511999998888"
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('55') && digits.length >= 12) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

// Mask phone for display: 5511******8888
function maskPhone(phone: string): string {
  if (phone.length < 8) return phone
  return `${phone.slice(0, 4)}${'*'.repeat(phone.length - 8)}${phone.slice(-4)}`
}

export async function POST(req: NextRequest) {
  try {
    const { phone, company_slug } = await req.json()

    if (!phone || !company_slug) {
      return NextResponse.json(
        { error: 'Telefone e empresa sao obrigatorios' },
        { status: 400 }
      )
    }

    const normalizedPhone = normalizePhone(phone)
    if (normalizedPhone.length < 12 || normalizedPhone.length > 13) {
      return NextResponse.json(
        { error: 'Telefone invalido. Informe DDD + numero.' },
        { status: 400 }
      )
    }

    // Rate limit: 3 OTPs per hour per phone
    const rl = rateLimit(`portal-wa-otp:${normalizedPhone}`, 3, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Muitos codigos enviados. Tente novamente em 1 hora.' },
        { status: 429 }
      )
    }

    const company = await prisma.company.findUnique({
      where: { slug: company_slug },
    })
    if (!company) {
      return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })
    }

    // Phone matching: search by mobile OR phone, with and without country code
    const phoneNoCC = normalizedPhone.startsWith('55') ? normalizedPhone.slice(2) : normalizedPhone
    const customer = await prisma.customer.findFirst({
      where: {
        company_id: company.id,
        deleted_at: null,
        OR: [
          { mobile: { contains: phoneNoCC } },
          { phone: { contains: phoneNoCC } },
          { mobile: { contains: normalizedPhone } },
          { phone: { contains: normalizedPhone } },
        ],
      },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Nao encontramos seu cadastro com este numero. Fale com nosso suporte.' },
        { status: 404 }
      )
    }

    // Ensure CustomerAccess record exists (create if first-time WhatsApp login)
    let access = await prisma.customerAccess.findUnique({
      where: {
        company_id_customer_id: { company_id: company.id, customer_id: customer.id },
      },
    })
    if (!access) {
      access = await prisma.customerAccess.create({
        data: {
          company_id: company.id,
          customer_id: customer.id,
          password_hash: '', // no password — WhatsApp OTP login only
          email_verified: false,
        },
      })
    }

    // Generate OTP (reuses LoginOtp table — same infrastructure as email OTP)
    const otpCode = generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await prisma.loginOtp.create({
      data: {
        company_id: company.id,
        customer_id: customer.id,
        code: otpCode,
        expires_at: expiresAt,
      },
    })

    // Send OTP via WhatsApp with progressive fallback chain:
    //   1. Try approved Meta template 'pt_portal_otp' (authentication category, works outside 24h)
    //   2. Fall back to plain Cloud text (works within 24h window)
    //   3. Fall back to Evolution API text (unofficial, works anytime)
    const otpText = `*${otpCode}* é seu código de acesso ao Portal ${company.name}.\n\nVálido por 10 minutos. Não compartilhe com ninguém.`

    void (async () => {
      const tmpl = await sendWhatsAppTemplate(
        company.id,
        normalizedPhone,
        'pt_portal_otp',
        'pt_BR',
        [{ type: 'body', parameters: [{ type: 'text', text: otpCode }] }],
        otpText // used by Evolution fallback if Meta Cloud isn't configured
      )
      if (tmpl.success) return
      console.warn('[Portal WA OTP] template failed, retrying as plain text:', tmpl.error)
      // Template may not exist yet — try plain text (Cloud 24h window or Evolution)
      const plain = await sendWhatsAppCloud(company.id, normalizedPhone, otpText)
      if (!plain.success) {
        console.error('[Portal WA OTP] all send methods failed:', { tmpl: tmpl.error, plain: plain.error })
      }
    })()

    return NextResponse.json({
      data: {
        requires_otp: true,
        customer_id: customer.id,
        company_id: company.id,
        phone_hint: maskPhone(normalizedPhone),
        message: 'Codigo enviado para seu WhatsApp.',
      },
    })
  } catch (err) {
    console.error('[Portal WA OTP Send Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
