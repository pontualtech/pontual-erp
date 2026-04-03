'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Plus, Search, FileText, AlertTriangle, DollarSign, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Contract {
  id: string
  number: string | null
  description: string | null
  start_date: string
  end_date: string
  monthly_value: number
  billing_day: number
  visit_frequency: string
  status: string
  auto_renew: boolean
  customers: { id: string; legal_name: string; phone: string | null; document_number: string | null } | null
  _count: { contract_equipment: number; contract_visits: number }
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function fmtDate(d: string) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('pt-BR')
}

const statusLabels: Record<string, string> = {
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Expirado',
}

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  SUSPENDED: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-gray-100 text-gray-500',
}

const frequencyLabels: Record<string, string> = {
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quinzenal',
  MONTHLY: 'Mensal',
  BIMONTHLY: 'Bimestral',
  QUARTERLY: 'Trimestral',
  SEMIANNUAL: 'Semestral',
  ANNUAL: 'Anual',
}

export default function ContratosPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)

      const res = await fetch(`/api/contracts?${params}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)

      setContracts(json.data || [])
      setTotalPages(json.totalPages || 1)
    } catch (err: any) {
      toast.error(err.message || 'Erro ao carregar contratos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page, statusFilter])

  // Summary cards
  const active = contracts.filter(c => c.status === 'ACTIVE')
  const totalMonthly = active.reduce((sum, c) => sum + (c.monthly_value || 0), 0)
  const now = new Date()
  const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const expiringSoon = active.filter(c => {
    const end = new Date(c.end_date)
    return end <= in30d && end >= now
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Contratos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Contratos de manutencao preventiva</p>
        </div>
        <Link
          href="/contratos/novo"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Novo Contrato
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Ativos</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{active.length}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Vencendo em 30d</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{expiringSoon.length}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <DollarSign className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Valor Mensal Total</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fmt(totalMonthly)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por numero, descricao ou cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setPage(1); load() } }}
            className="w-full rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-gray-100"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 px-3 py-2 text-sm dark:text-gray-100"
        >
          <option value="">Todos os Status</option>
          <option value="ACTIVE">Ativo</option>
          <option value="SUSPENDED">Suspenso</option>
          <option value="EXPIRED">Expirado</option>
          <option value="CANCELLED">Cancelado</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : contracts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/20 mb-4">
            <FileText className="h-8 w-8 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Nenhum contrato encontrado</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mb-1">
            Gerencie contratos de manutencao preventiva com seus clientes.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 max-w-sm mb-6">
            Defina equipamentos cobertos, frequencia de visitas, valor mensal e acompanhe vencimentos automaticamente.
          </p>
          <Link
            href="/contratos/novo"
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Criar Primeiro Contrato
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 dark:bg-gray-900/50 dark:border-gray-700 text-left">
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Numero</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Cliente</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Periodo</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Frequencia</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Valor Mensal</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Equipam.</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {contracts.map(c => {
                const endDate = new Date(c.end_date)
                const isExpiring = c.status === 'ACTIVE' && endDate <= in30d && endDate >= now
                return (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/contratos/${c.id}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                        {c.number || c.id.slice(0, 8)}
                      </Link>
                      {c.description && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[200px]">{c.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                      {c.customers?.legal_name || '--'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      <span>{fmtDate(c.start_date)}</span>
                      <span className="mx-1 text-gray-400">-</span>
                      <span className={cn(isExpiring && 'text-amber-600 font-medium')}>{fmtDate(c.end_date)}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {frequencyLabels[c.visit_frequency] || c.visit_frequency}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      {fmt(c.monthly_value || 0)}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {c._count.contract_equipment}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', statusColors[c.status] || 'bg-gray-100 text-gray-600')}>
                        {statusLabels[c.status] || c.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t dark:border-gray-700 px-4 py-3">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                Anterior
              </button>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Pagina {page} de {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                Proxima
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
