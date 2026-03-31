'use client'

import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, ArrowLeft, Database, Users, Wrench, FileText } from 'lucide-react'
import Link from 'next/link'

interface SyncResult {
  success: boolean
  error?: string
  summary?: {
    os_downloaded: number
    os_created: number
    os_updated: number
    os_skipped: number
    clients_created: number
    clients_updated: number
    items_created: number
    total_os: number
    total_customers: number
    next_os_number: number
  }
  log?: string[]
}

export default function SyncVHSysPage() {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [progress, setProgress] = useState('')
  const [limit, setLimit] = useState(500)

  async function handleSync() {
    if (syncing) return
    if (!confirm(`Sincronizar as ultimas ${limit} OS do VHSys?\n\nIsso pode levar alguns minutos.`)) return

    setSyncing(true)
    setResult(null)
    setProgress('Conectando ao VHSys via proxy...')

    try {
      const res = await fetch('/api/sync-vhsys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
      })
      const data = await res.json()
      setResult(data)
      setProgress('')
    } catch (e: any) {
      setResult({ success: false, error: e.message })
      setProgress('')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-lg p-2 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sincronizar VHSys</h1>
          <p className="text-sm text-gray-500">Importar OS, clientes e servicos do VHSys para o ERP</p>
        </div>
      </div>

      {/* Info Card */}
      <div className="rounded-lg border bg-blue-50 p-4">
        <h3 className="font-medium text-blue-900">Como funciona</h3>
        <ul className="mt-2 space-y-1 text-sm text-blue-800">
          <li>• Busca as ultimas OS do VHSys via proxy (Vercel gru1 - SP)</li>
          <li>• Importa clientes novos e atualiza existentes</li>
          <li>• Clona os numeros de OS originais do VHSys</li>
          <li>• Importa a discriminacao de servicos e pecas de cada OS</li>
          <li>• OS ja existentes no ERP sao atualizadas (nao duplica)</li>
        </ul>
      </div>

      {/* Controls */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Quantidade de OS
            </label>
            <select
              value={limit}
              onChange={e => setLimit(Number(e.target.value))}
              disabled={syncing}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value={100}>Ultimas 100 OS</option>
              <option value={250}>Ultimas 250 OS</option>
              <option value={500}>Ultimas 500 OS</option>
            </select>
          </div>

          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar Agora'}
          </button>
        </div>

        {syncing && progress && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
            <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            {progress}
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className={`rounded-lg border p-6 shadow-sm ${result.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <div className="flex items-center gap-2">
            {result.success ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600" />
            )}
            <h3 className={`font-semibold ${result.success ? 'text-green-900' : 'text-red-900'}`}>
              {result.success ? 'Sincronizacao Concluida!' : 'Erro na Sincronizacao'}
            </h3>
          </div>

          {result.error && (
            <p className="mt-2 text-sm text-red-700">{result.error}</p>
          )}

          {result.summary && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Database className="h-3.5 w-3.5" />
                  OS Novas
                </div>
                <p className="mt-1 text-2xl font-bold text-green-700">{result.summary.os_created}</p>
              </div>
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <RefreshCw className="h-3.5 w-3.5" />
                  OS Atualizadas
                </div>
                <p className="mt-1 text-2xl font-bold text-blue-700">{result.summary.os_updated}</p>
              </div>
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Users className="h-3.5 w-3.5" />
                  Clientes Novos
                </div>
                <p className="mt-1 text-2xl font-bold text-purple-700">{result.summary.clients_created}</p>
              </div>
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Wrench className="h-3.5 w-3.5" />
                  Itens/Servicos
                </div>
                <p className="mt-1 text-2xl font-bold text-orange-700">{result.summary.items_created}</p>
              </div>
            </div>
          )}

          {result.summary && (
            <div className="mt-4 rounded-lg bg-white p-3 shadow-sm">
              <h4 className="mb-2 text-xs font-medium text-gray-500 uppercase">Totais no ERP</h4>
              <div className="flex flex-wrap gap-4 text-sm">
                <span><strong>{result.summary.total_os}</strong> OS</span>
                <span><strong>{result.summary.total_customers}</strong> Clientes</span>
                <span>Proxima OS: <strong>#{result.summary.next_os_number}</strong></span>
              </div>
            </div>
          )}

          {/* Log */}
          {result.log && result.log.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-900">
                Ver log detalhado ({result.log.length} linhas)
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto rounded bg-gray-900 p-3 text-xs text-green-400">
                {result.log.join('\n')}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
