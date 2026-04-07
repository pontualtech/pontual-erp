'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { cn, formatDocument } from '@/lib/utils'
import {
  ArrowLeft, FileText, Plus, Download, XCircle, Edit3, RotateCcw,
  Loader2, Filter, ChevronLeft, ChevronRight, Search,
  AlertTriangle, Home,
} from 'lucide-react'
import { toast } from 'sonner'

// ---------- Types ----------

interface Nota {
  id: string
  invoice_number: number | null
  series: string | null
  invoice_type: string
  status: string
  total_amount: number
  tax_amount: number
  issued_at: string | null
  created_at: string
  access_key: string | null
  danfe_url: string | null
  xml_url: string | null
  provider_ref: string | null
  notes: string | null
  customers: { id: string; legal_name: string; document_number: string | null } | null
  _count: { invoice_items: number }
}

// ---------- Helpers ----------

const statusColor: Record<string, string> = {
  AUTHORIZED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-600',
  REJECTED: 'bg-red-100 text-red-700',
  PROCESSING: 'bg-yellow-100 text-yellow-700',
  DRAFT: 'bg-gray-100 text-gray-600',
  ERROR: 'bg-red-100 text-red-700',
}

const statusLabel: Record<string, string> = {
  AUTHORIZED: 'Autorizada',
  CANCELLED: 'Cancelada',
  REJECTED: 'Rejeitada',
  PROCESSING: 'Processando',
  DRAFT: 'Rascunho',
  ERROR: 'Erro',
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function extractNatureza(notes: string | null): string {
  if (!notes) return '---'
  // notes format: "[tipo] NATUREZA_OPERACAO | motivo" or "NF-e X Serie Y - NATUREZA"
  const match = notes.match(/\]\s*(.+?)(?:\s*\||$)/)
  if (match) return match[1].trim()
  const match2 = notes.match(/- (.+?)(?:\s*\||$)/)
  if (match2) return match2[1].trim()
  return notes.split('|')[0].trim().substring(0, 40)
}

// ---------- Cancel Modal ----------

function CancelModal({
  nota,
  onClose,
  onSuccess,
}: {
  nota: Nota
  onClose: () => void
  onSuccess: () => void
}) {
  const [justificativa, setJustificativa] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCancel() {
    if (justificativa.length < 15) return
    setLoading(true)
    try {
      const res = await fetch('/api/fiscal/nfe-cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: nota.id, justificativa }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao cancelar NF-e')
        return
      }
      if (data.data?.cancelado) {
        toast.success(`NF-e #${nota.invoice_number} cancelada com sucesso!`)
        onSuccess()
      } else {
        toast.error(`Cancelamento rejeitado: ${data.data?.motivo || 'Motivo desconhecido'}`)
      }
    } catch {
      toast.error('Erro de conexao com o servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Cancelar NF-e</h3>
        <p className="text-sm text-gray-500 mb-4">
          NF-e {nota.invoice_number ? `#${nota.invoice_number}` : '---'} - {nota.customers?.legal_name || '---'}
        </p>
        <div className="mb-4">
          <label htmlFor="cancel-justificativa" className="block text-sm font-medium text-gray-700 mb-1">
            Justificativa do cancelamento
          </label>
          <textarea
            id="cancel-justificativa"
            rows={3}
            placeholder="Informe o motivo do cancelamento (minimo 15 caracteres)..."
            value={justificativa}
            onChange={e => setJustificativa(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 resize-none"
          />
          <p className="mt-1 text-xs text-gray-400">{justificativa.length}/15 caracteres minimos</p>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Voltar
          </button>
          <button type="button" onClick={handleCancel}
            disabled={justificativa.length < 15 || loading}
            className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            Confirmar Cancelamento
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- CCe Modal ----------

function CceModal({
  nota,
  onClose,
  onSuccess,
}: {
  nota: Nota
  onClose: () => void
  onSuccess: () => void
}) {
  const [correcao, setCorrecao] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCce() {
    if (correcao.length < 15) return
    setLoading(true)
    try {
      const res = await fetch('/api/fiscal/nfe-cce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: nota.id, correcao }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao enviar Carta de Correcao')
        return
      }
      if (data.data?.aceito) {
        toast.success(`Carta de Correcao registrada (Seq. ${data.data.sequencial})`)
        onSuccess()
      } else {
        toast.error(`CCe rejeitada: ${data.data?.motivo || 'Motivo desconhecido'}`)
      }
    } catch {
      toast.error('Erro de conexao com o servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Carta de Correcao Eletronica</h3>
        <p className="text-sm text-gray-500 mb-1">
          NF-e {nota.invoice_number ? `#${nota.invoice_number}` : '---'} - {nota.customers?.legal_name || '---'}
        </p>
        <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 mb-4">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
          A CCe nao pode corrigir valores, base de calculo, aliquota, quantidade, dados cadastrais do remetente/destinatario ou data de emissao.
        </div>
        <div className="mb-4">
          <label htmlFor="cce-correcao" className="block text-sm font-medium text-gray-700 mb-1">
            Texto da correcao
          </label>
          <textarea
            id="cce-correcao"
            rows={4}
            placeholder="Descreva a correcao a ser feita (minimo 15 caracteres)..."
            value={correcao}
            onChange={e => setCorrecao(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <p className="mt-1 text-xs text-gray-400">{correcao.length}/15 caracteres minimos</p>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button type="button" onClick={handleCce}
            disabled={correcao.length < 15 || loading}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit3 className="h-4 w-4" />}
            Enviar Carta de Correcao
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Main Component ----------

export default function NfeListPage() {
  const [notas, setNotas] = useState<Nota[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // Modals
  const [cancelNota, setCancelNota] = useState<Nota | null>(null)
  const [cceNota, setCceNota] = useState<Nota | null>(null)

  const loadNotas = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (statusFilter) params.set('status', statusFilter)
    if (searchTerm) params.set('search', searchTerm)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)

    fetch(`/api/fiscal/nfe?${params}`)
      .then(r => r.json())
      .then(d => {
        setNotas(d.data ?? [])
        setTotalPages(d.totalPages ?? 1)
        setTotal(d.total ?? 0)
      })
      .catch(() => toast.error('Erro ao carregar NF-e'))
      .finally(() => setLoading(false))
  }, [statusFilter, searchTerm, startDate, endDate, page])

  useEffect(() => {
    loadNotas()
  }, [loadNotas])

  // Debounced search
  const [searchInput, setSearchInput] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <Link href="/" className="hover:text-gray-600 flex items-center gap-1">
          <Home className="h-3.5 w-3.5" /> Inicio
        </Link>
        <span>/</span>
        <Link href="/fiscal" className="hover:text-gray-600">Fiscal</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">NF-e</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/fiscal" className="rounded-lg border p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">NF-e Emitidas</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Notas Fiscais Eletronicas de Produto (Modelo 55)
            </p>
          </div>
        </div>
        <Link
          href="/fiscal/nfe/emitir"
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Emitir NF-e
        </Link>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por cliente, numero ou chave..."
              aria-label="Buscar NF-e"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              aria-label="Filtrar por status"
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              className="rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              <option value="">Todos os status</option>
              <option value="DRAFT">Rascunho</option>
              <option value="PROCESSING">Processando</option>
              <option value="AUTHORIZED">Autorizada</option>
              <option value="REJECTED">Rejeitada</option>
              <option value="CANCELLED">Cancelada</option>
              <option value="ERROR">Erro</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="nfe-start" className="text-sm text-gray-500">De</label>
            <input id="nfe-start" type="date" value={startDate}
              onChange={e => { setStartDate(e.target.value); setPage(1) }}
              className="rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="nfe-end" className="text-sm text-gray-500">Ate</label>
            <input id="nfe-end" type="date" value={endDate}
              onChange={e => { setEndDate(e.target.value); setPage(1) }}
              className="rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>

          {(statusFilter || startDate || endDate || searchInput) && (
            <button type="button"
              onClick={() => { setStatusFilter(''); setStartDate(''); setEndDate(''); setSearchInput(''); setPage(1) }}
              className="text-sm text-blue-600 hover:underline">
              Limpar filtros
            </button>
          )}

          <span className="ml-auto text-sm text-gray-400">
            {total} nota{total !== 1 ? 's' : ''} encontrada{total !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Numero</th>
              <th className="px-4 py-3">Serie</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Natureza</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
                  <p className="mt-2 text-sm text-gray-400">Carregando NF-e...</p>
                </td>
              </tr>
            ) : notas.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
                  <FileText className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-3 text-sm font-medium text-gray-500">Nenhuma NF-e encontrada</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {statusFilter || startDate || endDate || searchInput
                      ? 'Tente alterar os filtros aplicados'
                      : 'Emita sua primeira NF-e clicando no botao acima'}
                  </p>
                  {!statusFilter && !startDate && !endDate && !searchInput && (
                    <Link href="/fiscal/nfe/emitir"
                      className="mt-4 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                      <Plus className="h-4 w-4" /> Emitir primeira NF-e
                    </Link>
                  )}
                </td>
              </tr>
            ) : (
              notas.map(n => (
                <tr key={n.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-gray-900">
                      {n.invoice_number || '---'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {n.series || '1'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {n.issued_at
                      ? new Date(n.issued_at).toLocaleDateString('pt-BR')
                      : new Date(n.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 truncate max-w-[200px]">
                      {n.customers?.legal_name ?? '---'}
                    </p>
                    {n.customers?.document_number && (
                      <p className="text-xs text-gray-400">{formatDocument(n.customers.document_number)}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-gray-600 text-xs truncate block max-w-[180px]">
                      {extractNatureza(n.notes)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {formatCurrency(n.total_amount ?? 0)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                      statusColor[n.status] ?? 'bg-gray-100 text-gray-700'
                    )}>
                      {statusLabel[n.status] ?? n.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {/* Download DANFE */}
                      {n.danfe_url && (
                        <a href={n.danfe_url} target="_blank" rel="noopener noreferrer" title="Download DANFE"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                          <FileText className="h-4 w-4" />
                        </a>
                      )}

                      {/* Download XML */}
                      {n.xml_url && (
                        <a href={n.xml_url} target="_blank" rel="noopener noreferrer" title="Download XML"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-green-50 hover:text-green-600 transition-colors">
                          <Download className="h-4 w-4" />
                        </a>
                      )}

                      {/* Carta de Correcao */}
                      {n.status === 'AUTHORIZED' && (
                        <button type="button" onClick={() => setCceNota(n)} title="Carta de Correcao"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-yellow-50 hover:text-yellow-600 transition-colors">
                          <Edit3 className="h-4 w-4" />
                        </button>
                      )}

                      {/* Cancelar */}
                      {n.status === 'AUTHORIZED' && (
                        <button type="button" onClick={() => setCancelNota(n)} title="Cancelar NF-e"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}

                      {/* Editar e Reenviar (rejeitadas) */}
                      {(n.status === 'REJECTED' || n.status === 'ERROR') && (
                        <Link href={`/fiscal/nfe/emitir?reemitir=${n.id}`} title="Editar e Reenviar"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-orange-50 hover:text-orange-600 transition-colors">
                          <RotateCcw className="h-4 w-4" />
                        </Link>
                      )}

                      {/* Motivo da rejeição */}
                      {(n.status === 'REJECTED' || n.status === 'ERROR') && n.notes && (
                        <button type="button" title={n.notes} onClick={() => toast.error(n.notes || 'Sem detalhes')}
                          className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                          <AlertTriangle className="h-4 w-4" />
                        </button>
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
        <div className="flex items-center justify-center gap-3">
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>
          <span className="text-sm text-gray-500">Pagina {page} de {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40">
            Proxima <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelNota && (
        <CancelModal nota={cancelNota} onClose={() => setCancelNota(null)} onSuccess={() => { setCancelNota(null); loadNotas() }} />
      )}

      {/* CCe Modal */}
      {cceNota && (
        <CceModal nota={cceNota} onClose={() => setCceNota(null)} onSuccess={() => { setCceNota(null); loadNotas() }} />
      )}
    </div>
  )
}
