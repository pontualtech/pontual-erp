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

  // F-UX-02 fix 23/05: link na pagina de erro pra cliente pedir novo link
  // via WhatsApp do suporte (sem endpoint publico anti-spam). Tenta detectar
  // empresa pelo localStorage; fallback PontualTech 2626-3841.
  const [supportWa, setSupportWa] = useState('551126263841')
  useEffect(() => {
    try {
      const co = localStorage.getItem('portal_company')
      if (co) {
        const p = JSON.parse(co)
        if (p?.support_whatsapp) setSupportWa(String(p.support_whatsapp).replace(/\D/g, ''))
      }
    } catch {}
  }, [])
  const supportMsg = encodeURIComponent('Olá! Meu link de acesso ao portal expirou — pode me enviar um novo?')

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

        // Safe redirect: only allow same-origin relative paths. Must start with
        // a single '/' and NOT '//...' (protocol-relative URL → external host)
        // or '/\\...' (Windows-style network path that some browsers treat as
        // protocol-relative). Without this check an attacker could craft
        // ?r=//evil.com and leak the magic-link token to their domain.
        const isSafe = redirectTo.startsWith('/')
          && !redirectTo.startsWith('//')
          && !redirectTo.startsWith('/\\')
        const safeRedirect = isSafe ? redirectTo : `/portal/${slug}`
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
            <h1 className="text-lg font-semibold text-slate-900 mb-2">Não foi possível acessar</h1>
            <p className="text-sm text-slate-600 mb-6">{errorMsg}</p>

            <a
              href={`https://wa.me/${supportWa}?text=${supportMsg}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6 py-3 rounded-lg text-sm transition mb-3 min-h-[44px] flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
              Pedir novo acesso pelo WhatsApp
            </a>

            <a
              href={`/portal/${slug}/login`}
              className="inline-block bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-6 py-2.5 rounded-lg text-sm transition"
            >
              Tenho senha cadastrada
            </a>
          </>
        )}
      </div>
    </div>
  )
}
