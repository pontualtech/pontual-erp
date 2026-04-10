import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { createPortalToken } from '@/lib/portal-auth'
import { timingSafeEqual } from 'crypto'

export async function POST(req: NextRequest) {
  try {
    const { customer_id, company_id, otp_code } = await req.json()

    if (!customer_id || !company_id || !otp_code) {
      return NextResponse.json(
        { error: 'Dados incompletos' },
        { status: 400 }
      )
    }

    const code = String(otp_code).trim()
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: 'Codigo deve ter 6 digitos' },
        { status: 400 }
      )
    }

    // Find the most recent valid OTP for this customer
    const otp = await prisma.loginOtp.findFirst({
      where: {
        company_id,
        customer_id,
        used: false,
        expires_at: { gte: new Date() },
      },
      orderBy: { created_at: 'desc' },
    })

    if (!otp) {
      return NextResponse.json(
        { error: 'Codigo expirado ou invalido. Solicite um novo codigo.' },
        { status: 401 }
      )
    }

    // Max 5 attempts per OTP
    if (otp.attempts >= 5) {
      await prisma.loginOtp.update({
        where: { id: otp.id },
        data: { used: true },
      })
      return NextResponse.json(
        { error: 'Muitas tentativas. Solicite um novo codigo.' },
        { status: 429 }
      )
    }

    // Timing-safe comparison
    const codeBuf = Buffer.from(code)
    const otpBuf = Buffer.from(otp.code)
    const isValid = codeBuf.length === otpBuf.length && timingSafeEqual(codeBuf, otpBuf)

    if (!isValid) {
      await prisma.loginOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      })
      const remaining = 4 - otp.attempts
      return NextResponse.json(
        { error: `Codigo incorreto. ${remaining > 0 ? `${remaining} tentativa(s) restante(s).` : 'Solicite um novo codigo.'}` },
        { status: 401 }
      )
    }

    // Mark OTP as used
    await prisma.loginOtp.update({
      where: { id: otp.id },
      data: { used: true },
    })

    // Validate customer belongs to this company
    const access = await prisma.customerAccess.findFirst({
      where: { company_id, customer_id },
    })
    if (!access) {
      return NextResponse.json(
        { error: 'Acesso nao autorizado para esta empresa' },
        { status: 403 }
      )
    }

    // Load customer data for response (verified IDs from access record)
    const customer = await prisma.customer.findUnique({
      where: { id: access.customer_id },
      select: { id: true, legal_name: true },
    })

    const company = await prisma.company.findUnique({
      where: { id: access.company_id },
      select: { id: true, name: true, slug: true },
    })

    // Update last login
    await prisma.customerAccess.update({
      where: { id: access.id },
      data: { last_login_at: new Date() },
    })

    // Create session token using verified IDs from database
    const token = createPortalToken(access.customer_id, access.company_id)

    const response = NextResponse.json({
      data: {
        customer: {
          id: customer?.id,
          name: customer?.legal_name,
        },
        company: {
          id: company?.id,
          name: company?.name,
          slug: company?.slug,
        },
      },
    })

    response.cookies.set('portal_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    })

    return response
  } catch (err) {
    console.error('[Portal Verify OTP Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
