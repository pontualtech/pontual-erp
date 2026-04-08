'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

export default function PortalRegistrarPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [document, setDocument] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    customer_name: string
    email_hint: string | null
    message: string
  } | null>(null)
  const [registered, setRegistered] = useState(false)

  function formatDocument(value: string) {
    const digits = value.replace(/\D/g, '')
    if (digits.length <= 11) {
      return digits
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    }
    return digits
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!document) {
      toast.error('Informe seu CPF ou CNPJ')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/portal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: document.replace(/\D/g, ''),
          company_slug: slug,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao verificar')
        return
      }

      setResult(data.data)
      setRegistered(true)
      toast.success('Acesso criado com sucesso!')
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Primeiro Acesso</h1>
            <p className="text-gray-500 mt-1">Crie seu acesso ao portal</p>
          </div>

          {!registered ? (
            /* Step 1: Enter document */
            <form onSubmit={handleVerify} className="space-y-5">
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
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors text-gray-900 placeholder-gray-400"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                    Verificando...
                  </>
                ) : (
                  'Verificar'
                )}
              </button>
            </form>
          ) : (
            /* Step 2: Success */
            <div className="space-y-5">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-6 h-6 text-green-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="font-medium text-green-900">Acesso criado!</p>
                    <p className="text-sm text-green-700 mt-1">
                      Cliente: <strong>{result?.customer_name}</strong>
                    </p>
                    {result?.email_hint && (
                      <p className="text-sm text-green-700 mt-1">
                        Email: {result.email_hint}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-6 h-6 text-blue-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  <div>
                    <p className="font-medium text-blue-900">Sua senha inicial</p>
                    <p className="text-sm text-blue-800 mt-1">
                      Sao os <strong>5 primeiros digitos</strong> do seu CPF/CNPJ.
                    </p>
                    <p className="text-xs text-blue-600 mt-2">
                      Exemplo: CPF 123.456.789-00 → senha: <strong>12345</strong>
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <p className="text-sm text-amber-800">
                    <strong>Dica:</strong> Troque sua senha no primeiro acesso para maior seguranca.
                  </p>
                </div>
              </div>

              <button
                onClick={() => router.push(`/portal/${slug}/login`)}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
              >
                Ir para o Login
              </button>
            </div>
          )}

          {/* Back to login */}
          <div className="mt-6 text-center">
            <Link
              href={`/portal/${slug}/login`}
              className="text-gray-500 hover:text-gray-700 text-sm"
            >
              Voltar para o login
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
