import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

const GENERIC_MESSAGE = 'Se o email estiver cadastrado, voce recebera um link para redefinir sua senha.'

export async function POST(request: NextRequest) {
  try {
    // UX-10 #1: rate limit por IP+email — endpoint era spammable (60 reqs/min/200 OK)
    // que abria vetor de enumeration timing + flood SMTP/WhatsApp.
    const ip = getClientIp(request)

    // Body parse seguro — não vaza 500 se body vazio (UX-10 #2)
    let email: string | undefined
    try {
      const body = await request.json()
      email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : undefined
    } catch {
      return NextResponse.json({ message: GENERIC_MESSAGE })
    }

    // Rate limit composto: IP global (anti-flood) + email-específico (anti-targeted)
    const ipLimit = rateLimit(`forgot:ip:${ip}`, 5, 60_000)
    if (!ipLimit.allowed) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde um momento.' }, { status: 429 })
    }
    if (email) {
      const emailLimit = rateLimit(`forgot:email:${email}`, 3, 15 * 60_000)
      if (!emailLimit.allowed) {
        // Mantém mensagem genérica pra não revelar se email existe
        return NextResponse.json({ message: GENERIC_MESSAGE })
      }
    }

    if (!email) {
      return NextResponse.json({ message: GENERIC_MESSAGE })
    }

    const supabase = createAdminClient()
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`,
    })

    return NextResponse.json({ message: GENERIC_MESSAGE })
  } catch (err) {
    console.error('[forgot-password]', err)
    return NextResponse.json({ message: GENERIC_MESSAGE })
  }
}
