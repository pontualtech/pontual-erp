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
      router.push(`/portal/${slug}`)
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setLoading(false)
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

          {/* Form */}
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
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Senha
              </label>
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

          {/* Register link */}
          <div className="mt-6 text-center">
            <p className="text-gray-500 text-sm">
              Primeiro acesso?{' '}
              <Link
                href={`/portal/${slug}/registrar`}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                Cadastre-se
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-400 text-xs mt-6">
          Powered by PontualERP
        </p>
      </div>
    </div>
  )
}
