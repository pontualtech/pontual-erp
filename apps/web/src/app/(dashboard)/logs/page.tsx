'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ArrowLeft, Search, Loader2, ChevronLeft, ChevronRight, Eye, X, RefreshCw, Globe, Monitor, Clock, User, FileText, Filter } from 'lucide-react'

interface AuditLog {
  id: string
  user_id: string
  user_name: string
  module: string
  action: string
  entity_id: string | null
  old_value: Record<string, any> | null
  new_value: Record<string, any> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

const MODULE_COLORS: Record<string, string> = {
  os: 'bg-blue-100 text-blue-700',
  clientes: 'bg-emerald-100 text-emerald-700',
  estoque: 'bg-amber-100 text-amber-700',
  financeiro: 'bg-green-100 text-green-700',
  fiscal: 'bg-purple-100 text-purple-700',
  config: 'bg-gray-100 text-gray-700',
  core: 'bg-indigo-100 text-indigo-700',
  tickets: 'bg-pink-100 text-pink-700',
  logistics: 'bg-sky-100 text-sky-700',
  contracts: 'bg-orange-100 text-orange-700',
  portal: 'bg-teal-100 text-teal-700',
}

const ACTION_LABELS: Record<string, string> = {
  'transition': 'Mudou Status',
  'create': 'Criou',
  'update': 'Atualizou',
  'delete': 'Excluiu',
  'add_item': 'Adicionou Item',
  'edit_item': 'Editou Item',
  'remove_item': 'Removeu Item',
  'apply_kit': 'Aplicou Kit',
  'quote_approved_by_customer': 'Cliente Aprovou',
  'quote_rejected_by_customer': 'Cliente Recusou',
  'product.create': 'Criou Produto',
  'product.update': 'Atualizou Produto',
  'stock.adjust': 'Ajustou Estoque',
  'stock.move': 'Movimentou Estoque',
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action.replace(/_/g, ' ').replace(/\./g, ' › ')
}

function getBrowser(ua: string | null): string {
  if (!ua) return '—'
  if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome'
  if (ua.includes('Edg')) return 'Edge'
  if (ua.includes('Firefox')) return 'Firefox'
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari'
  if (ua.includes('bot') || ua.includes('Bot')) return 'Bot/API'
  return 'Outro'
}

export default function LogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [modules, setModules] = useState<string[]>([])

  // Filters
  const [search, setSearch] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Detail modal
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)

  function loadLogs() {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '50')
    if (search) params.set('search', search)
    if (moduleFilter) params.set('module', moduleFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)

    fetch(`/api/audit-logs?${params}`)
      .then(r => r.json())
      .then(d => {
        setLogs(d.data?.logs ?? [])
        setTotal(d.data?.total ?? 0)
        setTotalPages(d.data?.totalPages ?? 1)
        if (d.data?.modules) setModules(d.data.modules)
      })
      .catch(() => toast.error('Erro ao carregar logs'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadLogs() }, [page, moduleFilter, dateFrom, dateTo])

  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); loadLogs() }, 500)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-lg p-2 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="h-5 w-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Logs de Atividade</h1>
            <p className="text-sm text-gray-500">{total.toLocaleString('pt-BR')} registros no total</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowFilters(!showFilters)}
            className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors', showFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50')}>
            <Filter className="h-4 w-4" /> Filtros
          </button>
          <button type="button" onClick={loadLogs} className="flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Atualizar
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Buscar</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Acao, entidade, usuario..."
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Modulo</label>
              <select value={moduleFilter} onChange={e => { setModuleFilter(e.target.value); setPage(1) }}
                title="Filtrar por modulo" className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                <option value="">Todos</option>
                {modules.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">De</label>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
                title="Data inicial" className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ate</label>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
                title="Data final" className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-300" /></div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">Nenhum log encontrado</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-2.5 w-40">Data/Hora</th>
                  <th className="px-4 py-2.5">Usuario</th>
                  <th className="px-4 py-2.5 w-24">Modulo</th>
                  <th className="px-4 py-2.5">Acao</th>
                  <th className="px-4 py-2.5 w-28">Entidade</th>
                  <th className="px-4 py-2.5 w-28">IP</th>
                  <th className="px-4 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setSelectedLog(log)}>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      <Clock className="h-3 w-3 inline mr-1 text-gray-400" />
                      {fmtDate(log.created_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-gray-400" />
                        <span className="font-medium text-gray-800">{log.user_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', MODULE_COLORS[log.module] || 'bg-gray-100 text-gray-600')}>
                        {log.module}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{getActionLabel(log.action)}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-gray-400 truncate max-w-[120px]" title={log.entity_id || ''}>
                      {log.entity_id ? log.entity_id.slice(0, 8) + '...' : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">
                      {log.ip_address ? (
                        <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{log.ip_address}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <button type="button" title="Ver detalhes" className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-xs text-gray-500">
              Pagina {page} de {totalPages} ({total.toLocaleString('pt-BR')} registros)
            </p>
            <div className="flex gap-1">
              <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
                className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-30 hover:bg-gray-50">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-30 hover:bg-gray-50">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedLog(null)}>
          <div className="mx-4 w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-4 sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">Detalhes do Log</h2>
              <button type="button" onClick={() => setSelectedLog(null)} title="Fechar" className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Data/Hora</p>
                  <p className="text-sm font-medium text-gray-900 mt-0.5">{fmtDate(selectedLog.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Usuario</p>
                  <p className="text-sm font-medium text-gray-900 mt-0.5">{selectedLog.user_name}</p>
                  <p className="text-xs text-gray-400">{selectedLog.user_id}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Modulo</p>
                  <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold mt-0.5 inline-block', MODULE_COLORS[selectedLog.module] || 'bg-gray-100 text-gray-600')}>
                    {selectedLog.module}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Acao</p>
                  <p className="text-sm font-medium text-gray-900 mt-0.5">{getActionLabel(selectedLog.action)}</p>
                  <p className="text-xs text-gray-400 font-mono">{selectedLog.action}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Entidade ID</p>
                  <p className="text-sm font-mono text-gray-700 mt-0.5 break-all">{selectedLog.entity_id || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Endereco IP</p>
                  <p className="text-sm font-mono text-gray-700 mt-0.5">{selectedLog.ip_address || '—'}</p>
                </div>
              </div>

              {/* User Agent */}
              {selectedLog.user_agent && (
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium mb-1">Navegador / Dispositivo</p>
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">{getBrowser(selectedLog.user_agent)}</span>
                  </div>
                  <p className="text-xs text-gray-400 font-mono mt-1 break-all">{selectedLog.user_agent}</p>
                </div>
              )}

              {/* Old / New Values */}
              {(selectedLog.old_value || selectedLog.new_value) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {selectedLog.old_value && (
                    <div>
                      <p className="text-xs text-red-500 uppercase font-medium mb-1">Valor Anterior</p>
                      <pre className="text-xs bg-red-50 border border-red-200 rounded-lg p-3 overflow-x-auto max-h-48 text-red-800">
                        {JSON.stringify(selectedLog.old_value, null, 2)}
                      </pre>
                    </div>
                  )}
                  {selectedLog.new_value && (
                    <div>
                      <p className="text-xs text-green-500 uppercase font-medium mb-1">Valor Novo</p>
                      <pre className="text-xs bg-green-50 border border-green-200 rounded-lg p-3 overflow-x-auto max-h-48 text-green-800">
                        {JSON.stringify(selectedLog.new_value, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
