'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [tokens, setTokens] = useState<{ access_token: string; refresh_token: string } | null>(null)
  const [parsing, setParsing] = useState(true)

  useEffect(() => {
    // Supabase sends recovery tokens in the URL hash fragment
    // Format: #access_token=...&refresh_token=...&type=recovery
    const hash = window.location.hash.substring(1)
    const params = new URLSearchParams(hash)

    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    const type = params.get('type')

    if (access_token && type === 'recovery') {
      setTokens({ access_token, refresh_token: refresh_token || '' })
    } else if (access_token) {
      // Some Supabase versions may not include type
      setTokens({ access_token, refresh_token: refresh_token || '' })
    } else {
      setMessage({ type: 'error', text: 'Link de redefinicao invalido ou expirado. Solicite um novo link.' })
    }

    setParsing(false)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)

    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'As senhas nao coincidem.' })
      return
    }

    if (password.length < 6) {
      setMessage({ type: 'error', text: 'A senha deve ter pelo menos 6 caracteres.' })
      return
    }

    if (!tokens) {
      setMessage({ type: 'error', text: 'Token de redefinicao nao encontrado.' })
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        setMessage({ type: 'success', text: 'Senha redefinida com sucesso! Redirecionando para o login...' })
        setTimeout(() => router.push('/login'), 2000)
      } else {
        setMessage({ type: 'error', text: data.error || 'Erro ao redefinir senha.' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Erro de conexao. Tente novamente.' })
    } finally {
      setLoading(false)
    }
  }

  if (parsing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">PontualERP</h1>
          <p className="text-gray-500 mt-2">Redefinir senha</p>
        </div>

        {!tokens ? (
          <div className="text-center space-y-4">
            {message && (
              <div className="rounded-md px-3 py-2 text-sm bg-red-50 text-red-700">
                {message.text}
              </div>
            )}
            <a
              href="/login"
              className="inline-block text-sm text-blue-600 hover:text-blue-700 hover:underline"
            >
              Voltar para o login
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Nova senha
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Minimo 6 caracteres"
                required
                minLength={6}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                Confirmar nova senha
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Repita a nova senha"
                required
                minLength={6}
              />
            </div>

            {message && (
              <div
                className={`rounded-md px-3 py-2 text-sm ${
                  message.type === 'success'
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-700'
                }`}
              >
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors"
            >
              {loading ? 'Redefinindo...' : 'Redefinir Senha'}
            </button>

            <div className="text-center">
              <a
                href="/login"
                className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
              >
                Voltar para o login
              </a>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
