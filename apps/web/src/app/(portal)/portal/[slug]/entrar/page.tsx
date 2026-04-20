'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

/**
 * Magic link landing page.
 * URL: /portal/{slug}/entrar?t=TOKEN&r=REDIRECT_PATH
 *
 * Flow:
 *   1. Extract token from ?t= param
 *   2. POST it to /api/portal/auth/auto-login (sets httpOnly session cookie)
 *   3. On success: redirect to ?r= path (or portal home)
 *   4. On failure: redirect to /login with error message
 */
export default function MagicLinkEntryPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const slug = params.slug as string
  const token = searchParams.get('t') || ''
  const redirectTo = searchParams.get('r') || `/portal/${slug}`

  const [status, setStatus] = useState<'loading' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMsg('Link invalido: token ausente')
      return
    }

    fetch('/api/portal/auth/auto-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setStatus('error')
          setErrorMsg(data?.error || 'Link expirado ou invalido')
          return
        }

        // Persist customer/company for client-side UI (matches login flow)
        if (data.data?.customer) {
          localStorage.setItem('portal_customer', JSON.stringify(data.data.customer))
        }
        if (data.data?.company) {
          localStorage.setItem('portal_company', JSON.stringify(data.data.company))
        }

        // Safe redirect: only allow same-origin paths
        const safeRedirect = redirectTo.startsWith('/') ? redirectTo : `/portal/${slug}`
        router.replace(safeRedirect)
      })
      .catch(() => {
        setStatus('error')
        setErrorMsg('Falha de conexao. Tente novamente.')
      })
  }, [token, redirectTo, slug, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <div className="mx-auto w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
            <h1 className="text-lg font-semibold text-slate-900 mb-2">Acessando sua conta...</h1>
            <p className="text-sm text-slate-500">Validando seu link de acesso</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-slate-900 mb-2">Nao foi possivel acessar</h1>
            <p className="text-sm text-slate-600 mb-6">{errorMsg}</p>
            <a
              href={`/portal/${slug}/login`}
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-lg text-sm transition"
            >
              Fazer login
            </a>
          </>
        )}
      </div>
    </div>
  )
}
