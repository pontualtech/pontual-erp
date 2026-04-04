import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email || typeof email !== 'string') {
      // Still return 200 with generic message to not reveal if email exists
      return NextResponse.json({
        message: 'Se o email estiver cadastrado, voce recebera um link para redefinir sua senha.',
      })
    }

    const supabase = createAdminClient()
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`,
    })

    // Always return success (don't reveal if email exists or not)
    return NextResponse.json({
      message: 'Se o email estiver cadastrado, voce recebera um link para redefinir sua senha.',
    })
  } catch (err) {
    console.error('[forgot-password]', err)
    // Still return 200 to not leak info
    return NextResponse.json({
      message: 'Se o email estiver cadastrado, voce recebera um link para redefinir sua senha.',
    })
  }
}
