'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * UX-4 #10: error boundary helper reusável por módulo.
 * Antes existia só em (dashboard)/error.tsx (catch all). Agora cada módulo
 * (financeiro, fiscal, os, logística, BI) isola seu erro — crash em chart
 * do BI não derruba financeiro.
 *
 * Loga estruturado (Coolify lê stdout) + reporta a /api/internal/log/client-error
 * pra futura agregação de bugs em produção.
 */
export function ModuleError({
  error,
  reset,
  moduleName,
}: {
  error: Error & { digest?: string }
  reset: () => void
  moduleName: string
}) {
  useEffect(() => {
    console.error(`[module-error] ${moduleName}:`, error)
    try {
      const body = JSON.stringify({
        module: moduleName,
        message: error?.message,
        digest: error?.digest,
        stack: error?.stack?.slice(0, 2000),
        path: typeof window !== 'undefined' ? window.location.pathname : '',
        ts: Date.now(),
      })
      if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
        navigator.sendBeacon('/api/internal/log/client-error', body)
      }
    } catch { /* swallow — telemetry never breaks UX */ }
  }, [error, moduleName])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 p-6">
      <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
        <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
      </div>
      <div className="text-center max-w-md">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Erro no módulo {moduleName}
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Algo deu errado ao carregar esta seção. As outras áreas do sistema continuam funcionando.
        </p>
        {error?.digest && (
          <p className="mt-2 text-[11px] text-gray-400 font-mono">ID: {error.digest}</p>
        )}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 min-h-[44px]"
        >
          <RefreshCw className="w-4 h-4" />
          Tentar novamente
        </button>
        <a
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-zinc-700 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800 min-h-[44px]"
        >
          Ir para o Dashboard
        </a>
      </div>
    </div>
  )
}
