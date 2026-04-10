import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken, createPortalToken } from '@/lib/portal-auth'
import { prisma } from '@pontual/db'

/**
 * POST /api/portal/auth/auto-login
 * Validates a magic access token and sets a portal session cookie.
 * Used when customer clicks a link from email/WhatsApp notifications.
 */
export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json().catch(() => ({ token: '' }))
    if (!token) {
      return NextResponse.json({ error: 'Token ausente' }, { status: 400 })
    }

    const payload = verifyAccessToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Token invalido ou expirado' }, { status: 401 })
    }

    // Validate customer exists
    const customer = await prisma.customer.findFirst({
      where: { id: payload.cid, company_id: payload.mid, deleted_at: null },
      select: { id: true, legal_name: true, trade_name: true, document_number: true, email: true },
    })

    if (!customer) {
      return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 })
    }

    // Ensure customerAccess exists (auto-create if needed for magic link users)
    let access = await prisma.customerAccess.findFirst({
      where: { customer_id: payload.cid, company_id: payload.mid },
    })

    if (!access) {
      // Auto-provision portal access for magic link (no password needed)
      access = await prisma.customerAccess.create({
        data: {
          customer_id: payload.cid,
          company_id: payload.mid,
          password_hash: '', // no password — magic link only
          last_login_at: new Date(),
        },
      })
    } else {
      await prisma.customerAccess.update({
        where: { id: access.id },
        data: { last_login_at: new Date() },
      })
    }

    // Create session token (7 days) and set cookie
    const sessionToken = createPortalToken(payload.cid, payload.mid)

    const company = await prisma.company.findFirst({
      where: { id: payload.mid },
      select: { id: true, name: true, slug: true },
    })

    const response = NextResponse.json({
      data: {
        customer: {
          id: customer.id,
          name: customer.legal_name || customer.trade_name || '',
          document: customer.document_number || '',
          email: customer.email || '',
        },
        company: company ? { id: company.id, name: company.name, slug: company.slug } : null,
      },
    })

    response.cookies.set('portal_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    })

    return response
  } catch (err) {
    console.error('[AutoLogin] Error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
