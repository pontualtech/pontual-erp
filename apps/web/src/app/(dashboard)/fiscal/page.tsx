'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Search, FileText, BarChart3 } from 'lucide-react'

interface FiscalDashboard {
  totalNfe: number
  totalNfse: number
  currentMonth: {
    authorized: number
    rejected: number
    processing: number
    revenueCents: number
    taxCents: number
  }
  monthlyBreakdown: { month: string; nfe: number; nfse: number; totalCents: number }[]
}

interface Nota {
  id: string
  invoice_number: string | null
  invoice_type: string
  status: string
  total_cents: number
  tax_cents: number
  issued_at: string | null
  created_at: string
  customers: { id: string; legal_name: string; document_number: string | null } | null
  _count: { invoice_items: number }
}

const statusColor: Record<string, string> = {
  AUTHORIZED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
  REJECTED: 'bg-red-100 text-red-700',
  PROCESSING: 'bg-yellow-100 text-yellow-700',
  DRAFT: 'bg-gray-100 text-gray-700',
}

const statusLabel: Record<string, string> = {
  AUTHORIZED: 'Autorizada',
  CANCELLED: 'Cancelada',
  REJECTED: 'Rejeitada',
  PROCESSING: 'Processando',
  DRAFT: 'Rascunho',
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function FiscalPage() {
  const [dashboard, setDashboard] = useState<FiscalDashboard | null>(null)
  const [notas, setNotas] = useState<Nota[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tipoFilter, setTipoFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    fetch('/api/fiscal/dashboard')
      .then(r => r.json())
      .then(d => setDashboard(d.data ?? null))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (tipoFilter) params.set('type', tipoFilter)
    fetch(`/api/fiscal?${params}`)
      .then(r => r.json())
      .then(d => {
        setNotas(d.data ?? [])
        setTotalPages(d.totalPages ?? 1)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [search, tipoFilter, page])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Fiscal</h1>
      </div>

      {/* Dashboard cards */}
      {dashboard && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">NF-e Emitidas</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{dashboard.totalNfe}</p>
          </div>
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">NFS-e Emitidas</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{dashboard.totalNfse}</p>
          </div>
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Faturamento (mes)</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{formatCurrency(dashboard.currentMonth.revenueCents)}</p>
          </div>
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Impostos (mes)</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{formatCurrency(dashboard.currentMonth.taxCents)}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Filtrar por tipo de nota"
          value={tipoFilter}
          onChange={e => { setTipoFilter(e.target.value); setPage(1) }}
          className="rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          <option value="">Todos os tipos</option>
          <option value="NFE">NF-e</option>
          <option value="NFCE">NFC-e</option>
          <option value="NFSE">NFS-e</option>
        </select>
      </div>

      {/* Notas table */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Numero</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
            ) : notas.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhuma nota encontrada</td></tr>
            ) : (
              notas.map(n => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/fiscal/${n.id}`} className="font-medium text-blue-600 hover:underline">
                      {n.invoice_number || '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium">{n.invoice_type}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{n.customers?.legal_name ?? '—'}</td>
                  <td className="px-4 py-3 font-medium">{formatCurrency(n.total_cents)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusColor[n.status] ?? 'bg-gray-100 text-gray-700')}>
                      {statusLabel[n.status] ?? n.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {n.issued_at ? new Date(n.issued_at).toLocaleDateString('pt-BR') : new Date(n.created_at).toLocaleDateString('pt-BR')}
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
