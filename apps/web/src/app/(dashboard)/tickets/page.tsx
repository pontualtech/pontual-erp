'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Plus, Search, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'

interface Ticket {
  id: string
  ticket_number: number
  subject: string
  status: string
  priority: string
  category: string | null
  source: string
  assigned_to: string | null
  assigned_user_name: string | null
  customer_name: string | null
  message_count: number
  created_at: string
}

const statusLabel: Record<string, string> = {
  ABERTO: 'Aberto',
  EM_ANDAMENTO: 'Em Andamento',
  RESOLVIDO: 'Resolvido',
  FECHADO: 'Fechado',
}

const statusColor: Record<string, string> = {
  ABERTO: 'bg-blue-100 text-blue-700',
  EM_ANDAMENTO: 'bg-amber-100 text-amber-700',
  RESOLVIDO: 'bg-green-100 text-green-700',
  FECHADO: 'bg-gray-100 text-gray-500',
}

const priorityLabel: Record<string, string> = {
  BAIXA: 'Baixa',
  NORMAL: 'Normal',
  ALTA: 'Alta',
  URGENTE: 'Urgente',
}

const priorityColor: Record<string, string> = {
  BAIXA: 'bg-gray-100 text-gray-600',
  NORMAL: 'bg-blue-100 text-blue-700',
  ALTA: 'bg-orange-100 text-orange-700',
  URGENTE: 'bg-red-100 text-red-700',
}

const sourceLabel: Record<string, string> = {
  INTERNO: 'Interno',
  CLIENTE: 'Cliente',
}

const sourceColor: Record<string, string> = {
  INTERNO: 'bg-blue-50 text-blue-600',
  CLIENTE: 'bg-green-50 text-green-600',
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [summary, setSummary] = useState({ abertos: 0, emAndamento: 0, resolvidosHoje: 0, total: 0 })

  function loadTickets() {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    if (priorityFilter) params.set('priority', priorityFilter)
    if (sourceFilter) params.set('source', sourceFilter)
    fetch(`/api/tickets?${params}`)
      .then(r => r.json())
      .then(d => {
        setTickets(d.data ?? [])
        setTotalPages(d.totalPages ?? 1)
      })
      .catch(() => toast.error('Erro ao carregar tickets'))
      .finally(() => setLoading(false))
  }

  // Load summary counts (all statuses, no filter)
  function loadSummary() {
    const today = new Date().toISOString().split('T')[0]

    Promise.all([
      fetch('/api/tickets?status=ABERTO&limit=1').then(r => r.json()),
      fetch('/api/tickets?status=EM_ANDAMENTO&limit=1').then(r => r.json()),
      fetch('/api/tickets?status=RESOLVIDO&limit=1').then(r => r.json()),
      fetch('/api/tickets?limit=1').then(r => r.json()),
    ]).then(([abertos, emAndamento, resolvidos, total]) => {
      setSummary({
        abertos: abertos.total ?? 0,
        emAndamento: emAndamento.total ?? 0,
        resolvidosHoje: resolvidos.total ?? 0,
        total: total.total ?? 0,
      })
    }).catch(() => {})
  }

  useEffect(() => { loadTickets() }, [search, statusFilter, priorityFilter, sourceFilter, page])
  useEffect(() => { loadSummary() }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Comunicacao / Tickets</h1>
        <Link
          href="/tickets/novo"
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Novo Ticket
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Abertos</p>
          <p className="text-2xl font-bold text-blue-600">{summary.abertos}</p>
        </div>
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Em Andamento</p>
          <p className="text-2xl font-bold text-amber-600">{summary.emAndamento}</p>
        </div>
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Resolvidos</p>
          <p className="text-2xl font-bold text-green-600">{summary.resolvidosHoje}</p>
        </div>
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</p>
          <p className="text-2xl font-bold text-gray-700 dark:text-gray-300">{summary.total}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            placeholder="Buscar por numero, assunto..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="w-full rounded-md border bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          title="Filtrar por status"
          className="rounded-md border bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          <option value="">Todos os status</option>
          <option value="ABERTO">Aberto</option>
          <option value="EM_ANDAMENTO">Em Andamento</option>
          <option value="RESOLVIDO">Resolvido</option>
          <option value="FECHADO">Fechado</option>
        </select>
        <select
          value={priorityFilter}
          onChange={e => { setPriorityFilter(e.target.value); setPage(1) }}
          title="Filtrar por prioridade"
          className="rounded-md border bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          <option value="">Todas prioridades</option>
          <option value="BAIXA">Baixa</option>
          <option value="NORMAL">Normal</option>
          <option value="ALTA">Alta</option>
          <option value="URGENTE">Urgente</option>
        </select>
        <select
          value={sourceFilter}
          onChange={e => { setSourceFilter(e.target.value); setPage(1) }}
          title="Filtrar por origem"
          className="rounded-md border bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          <option value="">Todas origens</option>
          <option value="INTERNO">Interno</option>
          <option value="CLIENTE">Cliente</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 dark:bg-gray-900 dark:border-gray-700 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
              <th className="px-4 py-3">Numero</th>
              <th className="px-4 py-3">Assunto</th>
              <th className="px-4 py-3">Prioridade</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Responsavel</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3 text-center">Msgs</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
            ) : tickets.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Nenhum ticket encontrado</td></tr>
            ) : (
              tickets.map(ticket => (
                <tr key={ticket.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                  <td className="px-4 py-3">
                    <Link href={`/tickets/${ticket.id}`} className="font-medium text-blue-600 hover:underline">
                      #{String(ticket.ticket_number).padStart(4, '0')}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-xs truncate">
                    <Link href={`/tickets/${ticket.id}`} className="hover:text-blue-600">
                      {ticket.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', priorityColor[ticket.priority])}>
                      {priorityLabel[ticket.priority] ?? ticket.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusColor[ticket.status])}>
                      {statusLabel[ticket.status] ?? ticket.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">
                    {ticket.assigned_user_name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', sourceColor[ticket.source])}>
                      {sourceLabel[ticket.source] ?? ticket.source}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                    {new Date(ticket.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {ticket.message_count}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-sm text-gray-500">Pagina {page} de {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Proxima
          </button>
        </div>
      )}
    </div>
  )
}
