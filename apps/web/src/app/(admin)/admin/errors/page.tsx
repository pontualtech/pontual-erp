'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react'

interface ErrorRow {
  id: string
  ts: string
  level: string
  message: string
  stack: string | null
  context_json: Record<string, any>
  user_id: string | null
  company_id: string | null
  request_id: string | null
}

interface ListResp {
  data: ErrorRow[]
  total: number
  page: number
  limit: number
  totalPages: number
}

const LEVEL_BADGE: Record<string, string> = {
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  info: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
}

export default function AdminErrorsPage() {
  const [data, setData] = useState<ListResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [level, setLevel] = useState<string>('')
  const [q, setQ] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '25' })
    if (level) params.set('level', level)
    if (q) params.set('q', q)
    if (companyId) params.set('company_id', companyId)
    try {
      const res = await fetch(`/api/admin/errors?${params}`)
      const json = await res.json()
      setData(json)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [page, level, q, companyId])

  useEffect(() => { load() }, [load])

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <AlertCircle className="h-6 w-6 text-amber-400" />
          Erros Capturados
        </h1>
        <p className="text-sm text-gray-500">Últimos 7 dias por padrão. Exceptions 500 do handleError global.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 p-3">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-gray-500" />
          <input
            type="text"
            placeholder="Buscar em message..."
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1) }}
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder:text-gray-600 outline-none"
          />
        </div>
        <select
          aria-label="Filtrar por nível"
          value={level}
          onChange={e => { setLevel(e.target.value); setPage(1) }}
          className="rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200"
        >
          <option value="">Todos os níveis</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <input
          type="text"
          placeholder="Company ID..."
          value={companyId}
          onChange={e => { setCompanyId(e.target.value); setPage(1) }}
          className="rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 w-48"
        />
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-gray-700 bg-gray-900 p-1.5 hover:bg-gray-800"
          title="Recarregar"
        >
          <RefreshCw className="h-4 w-4 text-gray-300" />
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
          </div>
        ) : !data || data.data.length === 0 ? (
          <p className="text-center text-gray-500 py-20">Nenhum erro no período/filtros</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs font-medium uppercase text-gray-500 bg-gray-900/50">
                <th className="px-3 py-3 w-8"><span className="sr-only">Expandir</span></th>
                <th className="px-3 py-3">Quando</th>
                <th className="px-3 py-3">Nível</th>
                <th className="px-3 py-3">Mensagem</th>
                <th className="px-3 py-3">Empresa</th>
                <th className="px-3 py-3">Request ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {data.data.map(row => {
                const isOpen = expanded.has(row.id)
                return (
                  <Fragment key={row.id}>
                    <tr className="hover:bg-gray-800/40 cursor-pointer" onClick={() => toggle(row.id)}>
                      <td className="px-3 py-2">
                        {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
                      </td>
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                        {new Date(row.ts).toLocaleString('pt-BR')}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${LEVEL_BADGE[row.level] || ''}`}>
                          {row.level}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-200 max-w-xl truncate" title={row.message}>
                        {row.message}
                      </td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">
                        {row.company_id ? row.company_id.slice(0, 8) + '…' : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">
                        {row.request_id ? row.request_id.slice(0, 8) + '…' : '—'}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-950/60">
                        <td colSpan={6} className="px-6 py-4 space-y-3">
                          {row.stack && (
                            <div>
                              <p className="text-xs font-semibold text-gray-400 mb-1">Stack</p>
                              <pre className="text-xs text-gray-400 overflow-x-auto bg-gray-950 p-3 rounded border border-gray-800 max-h-96">
                                {row.stack}
                              </pre>
                            </div>
                          )}
                          {row.context_json && Object.keys(row.context_json).length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-400 mb-1">Context</p>
                              <pre className="text-xs text-gray-400 overflow-x-auto bg-gray-950 p-3 rounded border border-gray-800">
                                {JSON.stringify(row.context_json, null, 2)}
                              </pre>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            {row.user_id && (
                              <div><span className="text-gray-500">User: </span><span className="text-gray-300 font-mono">{row.user_id}</span></div>
                            )}
                            {row.company_id && (
                              <div><span className="text-gray-500">Company: </span><span className="text-gray-300 font-mono">{row.company_id}</span></div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {data.total.toLocaleString('pt-BR')} erros — página {data.page} de {data.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-gray-700 bg-gray-900 px-3 py-1 text-sm text-gray-300 disabled:opacity-40 hover:bg-gray-800"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= data.totalPages}
              className="rounded-md border border-gray-700 bg-gray-900 px-3 py-1 text-sm text-gray-300 disabled:opacity-40 hover:bg-gray-800"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
