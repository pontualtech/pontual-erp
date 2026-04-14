'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/use-auth'
import { Activity, RefreshCw, CheckCircle, XCircle, Eye, MessageCircle, Star, LogIn, CreditCard, Wrench, Package, FileText, Clock, Filter, ChevronDown, Globe, User, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LogEntry {
  id: string
  type: string
  module: string
  action: string
  entity_id: string | null
  os_number: number | null
  customer_name: string | null
  user_id: string
  user_name: string
  description: string
  old_value: any
  new_value: any
  ip_address: string | null
  timestamp: string
}

const TYPE_CONFIG: Record<string, { label: string; icon: any; bg: string; text: string; border: string }> = {
  approval:   { label: 'Aprovado',     icon: CheckCircle,   bg: 'bg-green-50',   text: 'text-green-700',   border: 'border-green-200' },
  rejection:  { label: 'Recusado',     icon: XCircle,       bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200' },
  transition: { label: 'Status',       icon: ArrowRight,    bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200' },
  create:     { label: 'Criado',       icon: Package,       bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  quote:      { label: 'Orcamento',    icon: FileText,      bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200' },
  item:       { label: 'Item OS',      icon: Wrench,        bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  nps:        { label: 'Avaliacao',    icon: Star,          bg: 'bg-yellow-50',  text: 'text-yellow-700',  border: 'border-yellow-200' },
  login:      { label: 'Login',        icon: LogIn,         bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200' },
  ticket:     { label: 'Ticket',       icon: MessageCircle, bg: 'bg-pink-50',    text: 'text-pink-700',    border: 'border-pink-200' },
  payment:    { label: 'Pagamento',    icon: CreditCard,    bg: 'bg-green-50',   text: 'text-green-700',   border: 'border-green-200' },
  bot:        { label: 'Bot',          icon: Activity,      bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200' },
  other:      { label: 'Outro',        icon: Eye,           bg: 'bg-gray-50',    text: 'text-gray-600',    border: 'border-gray-200' },
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `ha ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `ha ${hours}h`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'ontem'
  if (days < 7) return `ha ${days} dias`
  return new Date(ts).toLocaleDateString('pt-BR')
}

function fullDate(ts: string): string {
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function PortalLogPage() {
  const { isAdmin } = useAuth()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      params.set('limit', '100')
      if (typeFilter) params.set('type', typeFilter)
      const res = await fetch(`/api/portal-log?${params}`)
      const json = await res.json()
      if (json.data?.logs) {
        setLogs(json.data.logs)
        setLastUpdate(new Date())
      }
    } catch {}
    setLoading(false)
  }, [typeFilter])

  useEffect(() => { loadLogs() }, [loadLogs])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(loadLogs, 30_000)
    return () => clearInterval(interval)
  }, [autoRefresh, loadLogs])

  if (!isAdmin) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Acesso restrito a administradores.</p></div>
  }

  const typeCounts: Record<string, number> = {}
  logs.forEach(l => { typeCounts[l.type] = (typeCounts[l.type] || 0) + 1 })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-blue-100">
            <Activity className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Atividade do Sistema</h1>
            <p className="text-sm text-gray-500">Tudo que aconteceu — portal, funcionarios, bot</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdate && <span className="text-xs text-gray-400">{lastUpdate.toLocaleTimeString('pt-BR')}</span>}
          <button type="button" onClick={() => setShowFilters(!showFilters)}
            className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', showFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50')}>
            <Filter className="h-3.5 w-3.5" /> Filtros
          </button>
          <button type="button" onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', autoRefresh ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600')}>
            {autoRefresh ? '● Auto' : '○ Parado'}
          </button>
          <button type="button" title="Atualizar" onClick={() => { setLoading(true); loadLogs() }}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 flex items-center gap-1.5">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Filter chips */}
      {showFilters && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setTypeFilter('')}
            className={cn('rounded-full px-3 py-1 text-xs font-medium border transition-colors', !typeFilter ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
            Todos ({logs.length})
          </button>
          {Object.entries(TYPE_CONFIG).filter(([key]) => typeCounts[key]).map(([key, cfg]) => {
            const Icon = cfg.icon
            return (
              <button key={key} type="button" onClick={() => setTypeFilter(typeFilter === key ? '' : key)}
                className={cn('rounded-full px-3 py-1 text-xs font-medium border transition-colors flex items-center gap-1',
                  typeFilter === key ? `${cfg.bg} ${cfg.text} ${cfg.border}` : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
                <Icon className="h-3 w-3" /> {cfg.label} ({typeCounts[key] || 0})
              </button>
            )
          })}
        </div>
      )}

      {/* Timeline */}
      {loading && logs.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-300" />
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border bg-white p-12 text-center">
          <Activity className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Nenhuma atividade encontrada</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => {
            const cfg = TYPE_CONFIG[log.type] || TYPE_CONFIG.other
            const Icon = cfg.icon
            const isExpanded = expandedId === log.id

            return (
              <div key={log.id}
                className={cn('rounded-xl border bg-white shadow-sm transition-all cursor-pointer hover:shadow-md', cfg.border)}
                onClick={() => setExpandedId(isExpanded ? null : log.id)}>

                <div className="flex items-start gap-3 p-4">
                  {/* Icon */}
                  <div className={cn('flex-shrink-0 flex items-center justify-center h-9 w-9 rounded-lg', cfg.bg)}>
                    <Icon className={cn('h-4.5 w-4.5', cfg.text)} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 font-medium leading-snug">{log.description}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', cfg.bg, cfg.text)}>{cfg.label}</span>
                      {log.os_number && (
                        <span className="text-xs font-mono text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">OS #{log.os_number}</span>
                      )}
                      {log.customer_name && (
                        <span className="text-xs text-gray-500 flex items-center gap-0.5"><User className="h-3 w-3" />{log.customer_name}</span>
                      )}
                    </div>
                  </div>

                  {/* Time + User */}
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-gray-400" title={fullDate(log.timestamp)}>{relativeTime(log.timestamp)}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{log.user_name}</p>
                    {log.ip_address && <p className="text-[10px] text-gray-300 flex items-center justify-end gap-0.5 mt-0.5"><Globe className="h-2.5 w-2.5" />{log.ip_address}</p>}
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t px-4 py-3 bg-gray-50/50 space-y-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-gray-400 uppercase font-medium">Data/Hora</span>
                        <p className="text-gray-700 mt-0.5 font-mono">{fullDate(log.timestamp)}</p>
                      </div>
                      <div>
                        <span className="text-gray-400 uppercase font-medium">Usuario</span>
                        <p className="text-gray-700 mt-0.5">{log.user_name}</p>
                        <p className="text-gray-400 font-mono text-[10px]">{log.user_id}</p>
                      </div>
                      <div>
                        <span className="text-gray-400 uppercase font-medium">Modulo</span>
                        <p className="text-gray-700 mt-0.5">{log.module}</p>
                      </div>
                      <div>
                        <span className="text-gray-400 uppercase font-medium">Acao</span>
                        <p className="text-gray-700 mt-0.5 font-mono text-[10px]">{log.action}</p>
                      </div>
                    </div>
                    {(log.old_value || log.new_value) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                        {log.old_value && Object.keys(log.old_value).length > 0 && (
                          <div>
                            <span className="text-[10px] text-red-500 uppercase font-medium">Antes</span>
                            <pre className="text-[10px] bg-red-50 border border-red-100 rounded-lg p-2 overflow-x-auto max-h-32 text-red-800 mt-0.5">{JSON.stringify(log.old_value, null, 2)}</pre>
                          </div>
                        )}
                        {log.new_value && Object.keys(log.new_value).length > 0 && (
                          <div>
                            <span className="text-[10px] text-green-500 uppercase font-medium">Depois</span>
                            <pre className="text-[10px] bg-green-50 border border-green-100 rounded-lg p-2 overflow-x-auto max-h-32 text-green-800 mt-0.5">{JSON.stringify(log.new_value, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
