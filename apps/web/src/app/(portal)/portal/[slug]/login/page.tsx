'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

export default function PortalLoginPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [company, setCompany] = useState<{ name: string; logo?: string } | null>(null)
  const [document, setDocument] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingCompany, setLoadingCompany] = useState(true)

  // Recuperar senha
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryDoc, setRecoveryDoc] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryResult, setRecoveryResult] = useState<{
    success: boolean
    email_hint: string | null
    message: string
  } | null>(null)

  useEffect(() => {
    fetch(`/api/portal/company?slug=${slug}`)
      .then(r => r.json())
      .then(res => {
        if (res.data) setCompany(res.data)
        else setCompany({ name: slug })
      })
      .catch(() => setCompany({ name: slug }))
      .finally(() => setLoadingCompany(false))
  }, [slug])

  function formatDocument(value: string) {
    const digits = value.replace(/\D/g, '')
    if (digits.length <= 11) {
      // CPF: 000.000.000-00
      return digits
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    }
    // CNPJ: 00.000.000/0000-00
    return digits
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!document || !password) {
      toast.error('Preencha todos os campos')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/portal/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: document.replace(/\D/g, ''),
          password,
          company_slug: slug,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao fazer login')
        return
      }

      // Token is stored in httpOnly cookie by the server (secure, not accessible via JS)
      // Only store non-sensitive display data in localStorage
      localStorage.setItem('portal_customer', JSON.stringify(data.data.customer))
      localStorage.setItem('portal_company', JSON.stringify(data.data.company))

      toast.success('Login realizado com sucesso!')
      try { const { portalEvents } = await import('@/lib/analytics'); portalEvents.login('cpf_cnpj') } catch {}
      router.push(`/portal/${slug}`)
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setLoading(false)
    }
  }

  async function handleRecovery(e: React.FormEvent) {
    e.preventDefault()
    if (!recoveryDoc) {
      toast.error('Informe seu CPF ou CNPJ')
      return
    }

    setRecoveryLoading(true)
    try {
      const res = await fetch('/api/portal/recuperar-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: recoveryDoc.replace(/\D/g, ''),
          company_slug: slug,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao resetar senha')
        return
      }

      setRecoveryResult(data)
      toast.success('Senha resetada com sucesso!')
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setRecoveryLoading(false)
    }
  }

  if (loadingCompany) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            {company?.logo ? (
              <img src={company.logo} alt={company.name} className="h-16 mx-auto mb-4" />
            ) : (
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
            )}
            <h1 className="text-2xl font-bold text-gray-900">{company?.name}</h1>
            <p className="text-gray-500 mt-1">Portal do Cliente</p>
          </div>

          {!showRecovery ? (
            <>
              {/* Login Form */}
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label htmlFor="document" className="block text-sm font-medium text-gray-700 mb-1">
                    CPF / CNPJ
                  </label>
                  <input
                    id="document"
                    type="text"
                    value={document}
                    onChange={e => setDocument(formatDocument(e.target.value))}
                    placeholder="000.000.000-00"
                    maxLength={18}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 placeholder-gray-400"
                    autoFocus
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                      Senha
                    </label>
                    <button
                      type="button"
                      onClick={() => { setShowRecovery(true); setRecoveryResult(null); setRecoveryDoc('') }}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Digite sua senha"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 placeholder-gray-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      Entrando...
                    </>
                  ) : (
                    'Entrar'
                  )}
                </button>
              </form>

              {/* Register links */}
              <div className="mt-6 space-y-3">
                <Link
                  href={`/portal/${slug}/cadastro`}
                  className="block w-full text-center py-3 rounded-xl border-2 border-blue-600 text-blue-600 font-semibold text-sm hover:bg-blue-50 transition-colors"
                >
                  Cadastre-se
                </Link>
                <p className="text-gray-400 text-xs text-center">
                  Ja tem cadastro mas nao tem senha?{' '}
                  <Link href={`/portal/${slug}/registrar`} className="text-blue-500 hover:underline">
                    Ative seu acesso aqui
                  </Link>
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Password Recovery */}
              {!recoveryResult ? (
                <form onSubmit={handleRecovery} className="space-y-5">
                  <div>
                    <label htmlFor="recovery-doc" className="block text-sm font-medium text-gray-700 mb-1">
                      CPF / CNPJ
                    </label>
                    <input
                      id="recovery-doc"
                      type="text"
                      value={recoveryDoc}
                      onChange={e => setRecoveryDoc(formatDocument(e.target.value))}
                      placeholder="000.000.000-00"
                      maxLength={18}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 placeholder-gray-400"
                      autoFocus
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={recoveryLoading}
                    className="w-full py-3 px-4 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {recoveryLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                        Resetando...
                      </>
                    ) : (
                      'Resetar Senha'
                    )}
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <svg className="w-6 h-6 text-green-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className="font-medium text-green-900">Senha resetada com sucesso!</p>
                        <p className="text-sm text-green-700 mt-1">
                          Use os 5 primeiros digitos do seu CPF/CNPJ como senha.
                        </p>
                      </div>
                    </div>
                  </div>

                  {recoveryResult.email_hint && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <p className="text-sm text-blue-800">
                        Um email foi enviado para <strong>{recoveryResult.email_hint}</strong> com as instrucoes.
                      </p>
                    </div>
                  )}

                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-sm text-amber-800">
                      <strong>Exemplo:</strong> CPF 123.456.789-00 → senha: <strong>12345</strong>
                    </p>
                  </div>
                </div>
              )}

              {/* Back to login */}
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => { setShowRecovery(false); setRecoveryResult(null) }}
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  Voltar ao login
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-gray-400 text-xs mt-6">
          Powered by PontualERP
        </p>
      </div>
    </div>
  )
}
