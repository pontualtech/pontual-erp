import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function POST() {
  try {
    const supabase = createClient()

    // Invalidate Supabase session
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('[auth/logout] Supabase signOut error:', error.message)
    }

    // Clear all Supabase auth cookies
    const cookieStore = cookies()
    const allCookies = cookieStore.getAll()
    for (const cookie of allCookies) {
      if (
        cookie.name.startsWith('sb-') ||
        cookie.name.includes('supabase') ||
        cookie.name.includes('auth-token')
      ) {
        cookieStore.set(cookie.name, '', {
          expires: new Date(0),
          path: '/',
        })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[auth/logout] Error:', err)
    return NextResponse.json({ error: 'Erro ao fazer logout' }, { status: 500 })
  }
}
