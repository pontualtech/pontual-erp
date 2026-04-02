'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { cn, formatDocument } from '@/lib/utils'
import {
  FileText, Plus, Download, XCircle,
  Eye, BarChart3, Loader2, RefreshCw, Filter,
  Printer, Send, AlertTriangle, RotateCcw,
} from 'lucide-react'

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
  invoice_number: number | null
  invoice_type: string
  status: string
  total_amount: number
  tax_amount: number
  issued_at: string | null
  created_at: string
  access_key: string | null
  danfe_url: string | null
  xml_url: string | null
  notes: string | null
  provider_ref: string | null
  customers: { id: string; legal_name: string; document_number: string | null } | null
  _count: { invoice_items: number }
}

const statusColor: Record<string, string> = {
  AUTHORIZED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
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
  const [statusFilter, setStatusFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [cancelJustificativa, setCancelJustificativa] = useState('')
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [selectedNota, setSelectedNota] = useState<Nota | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  async function handleResendEmail(nota: Nota) {
    if (!nota.customers) return
    setResendingId(nota.id)
    try {
      const res = await fetch(`/api/fiscal/nfse/${nota.id}/reenviar`, { method: 'POST' })
      if (res.ok) {
        const toast = (await import('sonner')).toast
        toast.success(`NFS-e #${nota.invoice_number} reenviada por email!`)
      }
    } catch {} finally { setResendingId(null) }
  }

  function handlePrintNfse(nota: Nota) {
    if (!nota.danfe_url) return
    window.open(nota.danfe_url, '_blank')
  }

  // Load dashboard
  useEffect(() => {
    fetch('/api/fiscal/dashboard')
      .then(r => r.json())
      .then(d => setDashboard(d.data ?? null))
      .catch(() => {})
  }, [])

  // Load NFS-e list
  const loadNotas = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    params.set('type', 'NFSE')
    if (statusFilter) params.set('status', statusFilter)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)

    fetch(`/api/fiscal?${params}`)
      .then(r => r.json())
      .then(d => {
        setNotas(d.data ?? [])
        setTotalPages(d.totalPages ?? 1)
        setTotal(d.total ?? 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [statusFilter, startDate, endDate, page])

  useEffect(() => {
    loadNotas()
  }, [loadNotas])

  function openCancelModal(nota: Nota) {
    setSelectedNota(nota)
    setCancelJustificativa('')
    setShowCancelModal(true)
  }

  async function handleCancel() {
    if (!selectedNota || cancelJustificativa.length < 15) return
    setCancelingId(selectedNota.id)
    try {
      const res = await fetch(`/api/fiscal/nfse/${selectedNota.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justificativa: cancelJustificativa }),
      })
      if (res.ok) {
        setShowCancelModal(false)
        loadNotas()
      }
    } catch {
      // error handled silently
    } finally {
      setCancelingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fiscal - NFS-e</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Gerenciamento de Notas Fiscais de Servico Eletronicas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/fiscal/nfe"
            className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100">
            NF-e Produto
          </Link>
          <Link href="/fiscal/nfe/recebidas"
            className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100">
            NF-e Recebidas
          </Link>
          <Link href="/fiscal/config"
            className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Config
          </Link>
          <Link href="/fiscal/emitir-nfse"
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> NFS-e
          </Link>
        </div>
      </div>

      {/* Summary cards */}
      {dashboard && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">NFS-e Emitidas</p>
                <p className="text-2xl font-bold text-gray-900">{dashboard.totalNfse}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                <BarChart3 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Faturamento (mes)</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(dashboard.currentMonth.revenueCents)}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-100">
                <RefreshCw className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Em Processamento</p>
                <p className="text-2xl font-bold text-gray-900">{dashboard.currentMonth.processing}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Rejeitadas (mes)</p>
                <p className="text-2xl font-bold text-gray-900">{dashboard.currentMonth.rejected}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            aria-label="Filtrar por status"
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">Todos os status</option>
            <option value="PROCESSING">Processando</option>
            <option value="AUTHORIZED">Autorizada</option>
            <option value="REJECTED">Rejeitada</option>
            <option value="CANCELLED">Cancelada</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="startDate" className="text-sm text-gray-500">De</label>
          <input
            id="startDate"
            type="date"
            value={startDate}
            onChange={e => { setStartDate(e.target.value); setPage(1) }}
            className="rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="endDate" className="text-sm text-gray-500">Ate</label>
          <input
            id="endDate"
            type="date"
            value={endDate}
            onChange={e => { setEndDate(e.target.value); setPage(1) }}
            className="rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        {(statusFilter || startDate || endDate) && (
          <button
            type="button"
            onClick={() => { setStatusFilter(''); setStartDate(''); setEndDate(''); setPage(1) }}
            className="text-sm text-blue-600 hover:underline"
          >
            Limpar filtros
          </button>
        )}

        <span className="ml-auto text-sm text-gray-400">
          {total} nota{total !== 1 ? 's' : ''} encontrada{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* NFS-e table */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Numero</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3 text-right">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
                  <p className="mt-2 text-sm text-gray-400">Carregando...</p>
                </td>
              </tr>
            ) : notas.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <FileText className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-400">Nenhuma NFS-e encontrada</p>
                  <Link
                    href="/fiscal/emitir-nfse"
                    className="mt-3 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                  >
                    <Plus className="h-4 w-4" /> Emitir primeira NFS-e
                  </Link>
                </td>
              </tr>
            ) : (
              notas.map(n => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/fiscal/nfse/${n.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {n.invoice_number || '—'}
                    </Link>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {n.provider_ref ? n.provider_ref.slice(0, 20) : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-900">{n.customers?.legal_name ?? '—'}</p>
                    {n.customers?.document_number && (
                      <p className="text-xs text-gray-400">{formatDocument(n.customers.document_number)}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">{formatCurrency(n.total_amount ?? 0)}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                      statusColor[n.status] ?? 'bg-gray-100 text-gray-700'
                    )}>
                      {statusLabel[n.status] ?? n.status}
                    </span>
                    {n.status === 'REJECTED' && n.notes && (
                      <p className="mt-1 text-xs text-red-500 max-w-[200px] truncate" title={n.notes}>
                        <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                        {n.notes}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {n.issued_at
                      ? new Date(n.issued_at).toLocaleDateString('pt-BR')
                      : new Date(n.created_at).toLocaleDateString('pt-BR')
                    }
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {n.danfe_url && (
                        <a href={n.danfe_url} target="_blank" rel="noopener noreferrer" title="Ver NFS-e"
                          className="rounded p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600">
                          <Eye className="h-4 w-4" />
                        </a>
                      )}
                      {n.danfe_url && (
                        <button type="button" onClick={() => handlePrintNfse(n)} title="Imprimir NFS-e"
                          className="rounded p-1.5 text-gray-400 hover:bg-green-50 hover:text-green-600">
                          <Printer className="h-4 w-4" />
                        </button>
                      )}
                      {n.status === 'AUTHORIZED' && n.customers && (
                        <button type="button" onClick={() => handleResendEmail(n)} title="Reenviar por email"
                          disabled={resendingId === n.id}
                          className="rounded p-1.5 text-gray-400 hover:bg-purple-50 hover:text-purple-600 disabled:opacity-50">
                          {resendingId === n.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </button>
                      )}
                      {(n.status === 'AUTHORIZED' || n.status === 'PROCESSING') && (
                        <button type="button" onClick={() => openCancelModal(n)} title="Cancelar NFS-e"
                          className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}
                      {n.status === 'REJECTED' && (
                        <>
                          <Link href={`/fiscal/nfse/${n.id}`} title="Ver detalhes"
                            className="rounded p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600">
                            <Eye className="h-4 w-4" />
                          </Link>
                          <Link href={`/fiscal/emitir-nfse?reemitir=${n.id}`} title="Reemitir NFS-e"
                            className="rounded p-1.5 text-gray-400 hover:bg-orange-50 hover:text-orange-600">
                            <RotateCcw className="h-4 w-4" />
                          </Link>
                        </>
                      )}
                    </div>
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
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-sm text-gray-500">Pagina {page} de {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Proxima
          </button>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && selectedNota && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Cancelar NFS-e</h3>
            <p className="text-sm text-gray-500 mb-4">
              NFS-e {selectedNota.invoice_number ? `#${selectedNota.invoice_number}` : selectedNota.provider_ref} - {selectedNota.customers?.legal_name}
            </p>

            <div className="mb-4">
              <label htmlFor="cancel-justificativa" className="block text-sm font-medium text-gray-700 mb-1">
                Justificativa do cancelamento
              </label>
              <textarea
                id="cancel-justificativa"
                rows={3}
                placeholder="Informe o motivo do cancelamento (minimo 15 caracteres)..."
                value={cancelJustificativa}
                onChange={e => setCancelJustificativa(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 resize-none"
              />
              <p className="mt-1 text-xs text-gray-400">
                {cancelJustificativa.length}/15 caracteres minimos
              </p>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelJustificativa.length < 15 || cancelingId === selectedNota.id}
                className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelingId === selectedNota.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Confirmar Cancelamento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
