'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Plus, Search, Copy, ExternalLink, X, XCircle,
  Clock, CheckCircle2, AlertTriangle, Ban, FileText, QrCode,
  Barcode, Receipt, Printer, Mail, Loader2
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Boleto {
  id: string
  description: string
  amount: number
  receivedAmount: number | null
  dueDate: string
  status: 'REGISTERED' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  nossoNumero: string
  barcode: string
  digitableLine: string
  boletoUrl: string | null
  pixCode: string | null
  customerName: string
  customerDocument: string
  createdAt: string
}

interface Summary {
  registered: number
  paid: number
  overdue: number
  cancelled: number
}

interface Receivable {
  id: string
  description: string
  total_amount: number
  due_date: string
  customers: { id: string; legal_name: string } | null
  boleto_url: string | null
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  REGISTERED: { label: 'Registrado', color: 'bg-blue-100 text-blue-800', icon: FileText },
  PAID: { label: 'Pago', color: 'bg-green-100 text-green-800', icon: CheckCircle2 },
  OVERDUE: { label: 'Vencido', color: 'bg-red-100 text-red-800', icon: AlertTriangle },
  CANCELLED: { label: 'Cancelado', color: 'bg-gray-100 text-gray-500', icon: Ban },
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copiado!`),
    () => toast.error(`Falha ao copiar ${label}`)
  )
}

export default function BoletosPage() {
  const [boletos, setBoletos] = useState<Boleto[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<Summary | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Generate modal
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [loadingReceivables, setLoadingReceivables] = useState(false)
  const [receivableSearch, setReceivableSearch] = useState('')
  const [generating, setGenerating] = useState<string | null>(null)

  // Cancel modal
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  // Detail modal
  const [detailBoleto, setDetailBoleto] = useState<Boleto | null>(null)

  // Email
  const [sendingEmail, setSendingEmail] = useState<string | null>(null)

  const loadBoletos = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (statusFilter) params.set('status', statusFilter)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)

    fetch(`/api/financeiro/boletos?${params}`)
      .then(r => r.json())
      .then(d => {
        setBoletos(d.data ?? [])
        setTotalPages(d.totalPages ?? 1)
        setTotal(d.total ?? 0)
        if (d.summary) setSummary(d.summary)
      })
      .catch(() => toast.error('Erro ao carregar boletos'))
      .finally(() => setLoading(false))
  }, [page, statusFilter, startDate, endDate])

  useEffect(() => { loadBoletos() }, [loadBoletos])

  function openGenerateModal() {
    setShowGenerateModal(true)
    setReceivableSearch('')
    loadReceivables('')
  }

  function loadReceivables(search: string) {
    setLoadingReceivables(true)
    const params = new URLSearchParams()
    params.set('limit', '20')
    params.set('status', 'PENDENTE')
    if (search) params.set('search', search)

    fetch(`/api/financeiro/contas-receber?${params}`)
      .then(r => r.json())
      .then(d => {
        // Filter out receivables that already have a boleto
        const available = (d.data ?? []).filter((r: Receivable) => !r.boleto_url)
        setReceivables(available)
      })
      .catch(() => toast.error('Erro ao carregar contas'))
      .finally(() => setLoadingReceivables(false))
  }

  async function handleGenerate(receivableId: string) {
    setGenerating(receivableId)
    try {
      const res = await fetch('/api/financeiro/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivable_id: receivableId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar boleto')
      toast.success('Boleto gerado com sucesso!')
      setShowGenerateModal(false)
      loadBoletos()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar boleto')
    } finally {
      setGenerating(null)
    }
  }

  async function handleCancel() {
    if (!cancelId) return
    setCancelling(true)
    try {
      const res = await fetch(`/api/financeiro/boletos/${cancelId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cancelar')
      toast.success('Boleto cancelado com sucesso')
      setCancelId(null)
      loadBoletos()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cancelar')
    } finally {
      setCancelling(false)
    }
  }

  function clearFilters() {
    setStatusFilter('')
    setStartDate('')
    setEndDate('')
    setPage(1)
  }

  function handlePrint(id: string) {
    window.open(`/boleto-print?ids=${id}`, '_blank')
  }

  async function handleSendEmail(id: string) {
    setSendingEmail(id)
    try {
      const res = await fetch('/api/financeiro/boletos/enviar-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivable_id: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar email')
      if (data.enviados > 0) {
        toast.success('Email enviado com sucesso!')
      } else {
        toast.error(data.detalhes?.[0]?.status === 'SEM_EMAIL' ? 'Cliente sem email cadastrado' : 'Falha ao enviar email')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar email')
    } finally {
      setSendingEmail(null)
    }
  }

  const hasFilters = statusFilter || startDate || endDate
  const boletoToCancel = boletos.find(b => b.id === cancelId)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/financeiro" className="text-gray-400 hover:text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Boletos</h1>
          </div>
          <p className="text-sm text-gray-500 ml-7">
            <Link href="/financeiro" className="text-blue-600 hover:underline">Financeiro</Link> / Boletos
          </p>
        </div>
        <button
          type="button"
          onClick={openGenerateModal}
          className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" /> Gerar Boleto
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-blue-50 p-2">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Registrados</p>
                <p className="text-xl font-bold text-blue-600">{summary.registered}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-green-50 p-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Pagos</p>
                <p className="text-xl font-bold text-green-600">{summary.paid}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-red-50 p-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Vencidos</p>
                <p className="text-xl font-bold text-red-600">{summary.overdue}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-gray-50 p-2">
                <Ban className="h-5 w-5 text-gray-500" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Cancelados</p>
                <p className="text-xl font-bold text-gray-500">{summary.cancelled}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[150px]">
            <label htmlFor="status-filter-boleto" className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              id="status-filter-boleto"
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              className="w-full rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">Todos</option>
              <option value="REGISTERED">Registrado</option>
              <option value="PAID">Pago</option>
              <option value="OVERDUE">Vencido</option>
              <option value="CANCELLED">Cancelado</option>
            </select>
          </div>
          <div className="min-w-[140px]">
            <label htmlFor="start-date-boleto" className="block text-xs font-medium text-gray-500 mb-1">De</label>
            <input
              id="start-date-boleto"
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setPage(1) }}
              className="w-full rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div className="min-w-[140px]">
            <label htmlFor="end-date-boleto" className="block text-xs font-medium text-gray-500 mb-1">Ate</label>
            <input
              id="end-date-boleto"
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setPage(1) }}
              className="w-full rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              <X className="h-3 w-3" /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Descricao</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Nosso Numero</th>
              <th className="px-4 py-3">Vencimento</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-right">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  <div className="flex items-center justify-center gap-2">
                    <Clock className="h-4 w-4 animate-spin" /> Carregando...
                  </div>
                </td>
              </tr>
            ) : boletos.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  {hasFilters ? 'Nenhum boleto encontrado com os filtros aplicados' : 'Nenhum boleto gerado ainda'}
                </td>
              </tr>
            ) : (
              boletos.map(boleto => {
                const config = statusConfig[boleto.status] || statusConfig.REGISTERED
                const StatusIcon = config.icon
                return (
                  <tr key={boleto.id} className="hover:bg-gray-50 group">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setDetailBoleto(boleto)}
                        className="text-left hover:text-blue-600"
                      >
                        <p className="font-medium text-gray-900">{boleto.description}</p>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {boleto.customerName || '--'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-gray-600">{boleto.nossoNumero}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {formatDate(boleto.dueDate)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-medium text-gray-900">{formatCurrency(boleto.amount)}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', config.color)}>
                        <StatusIcon className="h-3 w-3" />
                        {config.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => handlePrint(boleto.id)}
                          title="Imprimir boleto"
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-orange-600"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSendEmail(boleto.id)}
                          disabled={sendingEmail === boleto.id}
                          title="Enviar por email"
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600 disabled:opacity-50"
                        >
                          {sendingEmail === boleto.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                        </button>
                        {boleto.digitableLine && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(boleto.digitableLine, 'Linha digitavel')}
                            title="Copiar linha digitavel"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-emerald-600"
                          >
                            <Barcode className="h-4 w-4" />
                          </button>
                        )}
                        {boleto.pixCode && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(boleto.pixCode!, 'Codigo PIX')}
                            title="Copiar PIX copia-e-cola"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-purple-600"
                          >
                            <QrCode className="h-4 w-4" />
                          </button>
                        )}
                        {boleto.boletoUrl && boleto.boletoUrl.startsWith('http') && (
                          <a
                            href={boleto.boletoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Ver PDF do boleto"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-emerald-600"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        {boleto.status === 'REGISTERED' && (
                          <button
                            type="button"
                            onClick={() => setCancelId(boleto.id)}
                            title="Cancelar boleto"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Mostrando {((page - 1) * 20) + 1} - {Math.min(page * 20, total)} de {total} resultados
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50"
            >
              Anterior
            </button>
            <span className="text-sm text-gray-500">Pagina {page} de {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50"
            >
              Proxima
            </button>
          </div>
        </div>
      )}

      {/* Generate Boleto Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowGenerateModal(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Gerar Boleto</h2>
              <button type="button" onClick={() => setShowGenerateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-500 mb-3">
                Selecione uma conta a receber pendente para gerar o boleto:
              </p>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por descricao ou cliente..."
                  value={receivableSearch}
                  onChange={e => {
                    setReceivableSearch(e.target.value)
                    loadReceivables(e.target.value)
                  }}
                  className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto space-y-2">
                {loadingReceivables ? (
                  <div className="flex items-center justify-center py-6 text-gray-400">
                    <Clock className="h-4 w-4 animate-spin mr-2" /> Carregando...
                  </div>
                ) : receivables.length === 0 ? (
                  <div className="py-6 text-center text-gray-400 text-sm">
                    Nenhuma conta pendente sem boleto encontrada
                  </div>
                ) : (
                  receivables.map(r => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border p-3 hover:bg-gray-50"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{r.description}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-gray-500">{r.customers?.legal_name || 'Sem cliente'}</span>
                          <span className="text-xs text-gray-400">Venc: {formatDate(r.due_date)}</span>
                          <span className="text-xs font-medium text-emerald-600">{formatCurrency(r.total_amount)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleGenerate(r.id)}
                        disabled={generating === r.id}
                        className="ml-3 shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {generating === r.id ? 'Gerando...' : 'Gerar'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {cancelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCancelId(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Cancelar boleto?</h2>
            <p className="text-sm text-gray-600 mb-4">
              Tem certeza que deseja cancelar o boleto de{' '}
              <strong>{boletoToCancel?.description}</strong>?
              {boletoToCancel && (
                <span className="block mt-1 text-gray-500">
                  Nosso numero: {boletoToCancel.nossoNumero} - Valor: {formatCurrency(boletoToCancel.amount)}
                </span>
              )}
            </p>
            <p className="text-xs text-amber-600 mb-4">
              O cancelamento sera enviado ao banco. A conta a receber tambem sera marcada como cancelada.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setCancelId(null)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {cancelling ? 'Cancelando...' : 'Confirmar Cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailBoleto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDetailBoleto(null)}>
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Detalhes do Boleto</h2>
              <button type="button" onClick={() => setDetailBoleto(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* Status badge */}
              {(() => {
                const config = statusConfig[detailBoleto.status] || statusConfig.REGISTERED
                const StatusIcon = config.icon
                return (
                  <div className="flex items-center gap-2">
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium', config.color)}>
                      <StatusIcon className="h-4 w-4" />
                      {config.label}
                    </span>
                  </div>
                )
              })()}

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500">Descricao</p>
                  <p className="text-sm font-medium text-gray-900">{detailBoleto.description}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Cliente</p>
                  <p className="text-sm font-medium text-gray-900">{detailBoleto.customerName || '--'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Valor</p>
                  <p className="text-sm font-bold text-emerald-600">{formatCurrency(detailBoleto.amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Vencimento</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(detailBoleto.dueDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Nosso Numero</p>
                  <p className="text-sm font-mono text-gray-900">{detailBoleto.nossoNumero}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">CPF/CNPJ</p>
                  <p className="text-sm text-gray-900">{detailBoleto.customerDocument || '--'}</p>
                </div>
              </div>

              {/* Copyable fields */}
              <div className="space-y-2">
                {detailBoleto.digitableLine && (
                  <div className="rounded-md border bg-gray-50 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-500">Linha Digitavel</p>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(detailBoleto.digitableLine, 'Linha digitavel')}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                      >
                        <Copy className="h-3 w-3" /> Copiar
                      </button>
                    </div>
                    <p className="text-sm font-mono text-gray-800 break-all">{detailBoleto.digitableLine}</p>
                  </div>
                )}
                {detailBoleto.barcode && (
                  <div className="rounded-md border bg-gray-50 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-500">Codigo de Barras</p>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(detailBoleto.barcode, 'Codigo de barras')}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                      >
                        <Copy className="h-3 w-3" /> Copiar
                      </button>
                    </div>
                    <p className="text-sm font-mono text-gray-800 break-all">{detailBoleto.barcode}</p>
                  </div>
                )}
                {detailBoleto.pixCode && (
                  <div className="rounded-md border bg-gray-50 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-500">PIX Copia e Cola</p>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(detailBoleto.pixCode!, 'Codigo PIX')}
                        className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800"
                      >
                        <Copy className="h-3 w-3" /> Copiar
                      </button>
                    </div>
                    <p className="text-sm font-mono text-gray-800 break-all">{detailBoleto.pixCode}</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handlePrint(detailBoleto.id)}
                  className="flex items-center gap-1.5 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
                >
                  <Printer className="h-4 w-4" /> Imprimir
                </button>
                <button
                  type="button"
                  onClick={() => handleSendEmail(detailBoleto.id)}
                  disabled={sendingEmail === detailBoleto.id}
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {sendingEmail === detailBoleto.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {sendingEmail === detailBoleto.id ? 'Enviando...' : 'Enviar Email'}
                </button>
                {detailBoleto.boletoUrl && detailBoleto.boletoUrl.startsWith('http') && (
                  <a
                    href={detailBoleto.boletoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                  >
                    <ExternalLink className="h-4 w-4" /> Ver PDF
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setDetailBoleto(null)}
                  className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
