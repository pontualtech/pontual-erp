import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const { password, access_token, refresh_token } = await request.json()

    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: 'A senha deve ter pelo menos 6 caracteres.' },
        { status: 400 }
      )
    }

    if (!access_token) {
      return NextResponse.json(
        { error: 'Token de redefinicao invalido ou expirado.' },
        { status: 400 }
      )
    }

    // Create a client and set the session from the recovery token
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // Set the session using the recovery tokens
    const { error: sessionError } = await supabase.auth.setSession({
      access_token,
      refresh_token: refresh_token || '',
    })

    if (sessionError) {
      console.error('[reset-password] session error:', sessionError)
      return NextResponse.json(
        { error: 'Token de redefinicao invalido ou expirado.' },
        { status: 400 }
      )
    }

    // Now update the password
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })

    if (updateError) {
      console.error('[reset-password] update error:', updateError)
      return NextResponse.json(
        { error: updateError.message || 'Erro ao redefinir senha.' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      message: 'Senha redefinida com sucesso!',
    })
  } catch (err) {
    console.error('[reset-password]', err)
    return NextResponse.json(
      { error: 'Erro interno do servidor.' },
      { status: 500 }
    )
  }
}
