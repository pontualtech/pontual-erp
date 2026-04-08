'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function VerificarEmailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slug = params.slug as string
  const token = searchParams.get('token')

  const [status, setStatus] = useState<'loading' | 'success' | 'already' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMsg('Link invalido. Token nao encontrado.')
      return
    }

    fetch('/api/portal/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, company_slug: slug }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setStatus('error')
          setErrorMsg(data.error)
        } else if (data.data?.already_verified) {
          setStatus('already')
        } else {
          setStatus('success')
        }
      })
      .catch(() => {
        setStatus('error')
        setErrorMsg('Erro de conexao. Tente novamente.')
      })
  }, [token, slug])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-zinc-950 dark:to-zinc-900 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl dark:shadow-zinc-900/50 p-8 dark:border dark:border-zinc-800 text-center">

          {status === 'loading' && (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-200 dark:border-blue-900 border-t-blue-600 dark:border-t-blue-400 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">Verificando seu email...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Email verificado!</h1>
              <p className="text-gray-500 dark:text-gray-400 mb-6">Sua conta esta ativa. Faca login para acessar o portal.</p>
              <Link
                href={`/portal/${slug}/login`}
                className="block w-full py-3 px-4 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors text-center"
              >
                Ir para o Login
              </Link>
            </>
          )}

          {status === 'already' && (
            <>
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Email ja verificado</h1>
              <p className="text-gray-500 dark:text-gray-400 mb-6">Seu email ja foi verificado anteriormente.</p>
              <Link
                href={`/portal/${slug}/login`}
                className="block w-full py-3 px-4 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors text-center"
              >
                Ir para o Login
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Erro na verificacao</h1>
              <p className="text-gray-500 dark:text-gray-400 mb-6">{errorMsg}</p>
              <Link
                href={`/portal/${slug}/login`}
                className="block w-full py-3 px-4 bg-gray-600 dark:bg-zinc-700 hover:bg-gray-700 dark:hover:bg-zinc-600 text-white font-semibold rounded-xl transition-colors text-center"
              >
                Voltar ao Login
              </Link>
            </>
          )}
        </div>

        <p className="text-center text-gray-400 dark:text-gray-500 text-xs mt-6">
          Powered by PontualERP
        </p>
      </div>
    </div>
  )
}
