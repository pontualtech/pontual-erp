'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, FileText, Download, Eye, XCircle,
  Loader2, RefreshCw, CheckCircle2, Clock, AlertTriangle,
  User, Calendar, DollarSign, Hash,
} from 'lucide-react'
import { toast } from 'sonner'

interface InvoiceDetail {
  id: string
  invoice_type: string
  invoice_number: number | null
  series: string | null
  access_key: string | null
  status: string
  provider_ref: string | null
  provider_name: string | null
  total_amount: number
  tax_amount: number
  issued_at: string | null
  authorized_at: string | null
  created_at: string
  notes: string | null
  xml_url: string | null
  danfe_url: string | null
  customers: {
    id: string
    legal_name: string
    document_number: string | null
    email: string | null
  } | null
  invoice_items: {
    id: string
    service_code: string | null
    description: string
    quantity: number
    unit_price: number
    total_price: number
    taxes: any
  }[]
  fiscal_logs: {
    id: string
    action: string
    status_code: number | null
    created_at: string
  }[]
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  AUTHORIZED: { label: 'Autorizada', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  PROCESSING: { label: 'Processando', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  REJECTED: { label: 'Rejeitada', color: 'bg-red-100 text-red-700', icon: XCircle },
  CANCELLED: { label: 'Cancelada', color: 'bg-gray-100 text-gray-600', icon: XCircle },
  DRAFT: { label: 'Rascunho', color: 'bg-gray-100 text-gray-700', icon: FileText },
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function NfseDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelJustificativa, setCancelJustificativa] = useState('')
  const [canceling, setCanceling] = useState(false)

  const loadInvoice = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    else setRefreshing(true)

    try {
      const res = await fetch(`/api/fiscal/nfse/${id}`)
      const data = await res.json()
      if (res.ok) {
        setInvoice(data.data)
      } else {
        toast.error(data.error || 'Erro ao carregar NFS-e')
      }
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [id])

  useEffect(() => {
    loadInvoice()
  }, [loadInvoice])

  // Auto-poll if processing
  useEffect(() => {
    if (invoice?.status !== 'PROCESSING') return
    const interval = setInterval(() => loadInvoice(false), 10000)
    return () => clearInterval(interval)
  }, [invoice?.status, loadInvoice])

  async function handleCancel() {
    if (cancelJustificativa.length < 15) return
    setCanceling(true)

    try {
      const res = await fetch(`/api/fiscal/nfse/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justificativa: cancelJustificativa }),
      })

      const data = await res.json()

      if (res.ok) {
        toast.success('NFS-e cancelada com sucesso')
        setShowCancelModal(false)
        loadInvoice()
      } else {
        toast.error(data.error || 'Erro ao cancelar')
      }
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setCanceling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="space-y-4">
        <Link href="/fiscal" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> Voltar para Fiscal
        </Link>
        <div className="rounded-lg border bg-white p-12 text-center shadow-sm">
          <XCircle className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-gray-500">NFS-e nao encontrada</p>
        </div>
      </div>
    )
  }

  const sc = statusConfig[invoice.status] || statusConfig.DRAFT
  const StatusIcon = sc.icon

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/fiscal" className="text-gray-400 hover:text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              NFS-e {invoice.invoice_number ? `#${invoice.invoice_number}` : ''}
            </h1>
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
              sc.color
            )}>
              <StatusIcon className="h-3 w-3" />
              {sc.label}
            </span>
          </div>
          <p className="text-sm text-gray-500 ml-7">
            <Link href="/fiscal" className="text-blue-600 hover:underline">Fiscal</Link> / Detalhe NFS-e
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadInvoice(false)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            Atualizar
          </button>

          {invoice.danfe_url && (
            <a
              href={invoice.danfe_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Eye className="h-4 w-4" /> Ver PDF
            </a>
          )}

          {invoice.xml_url && (
            <a
              href={invoice.xml_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Download className="h-4 w-4" /> XML
            </a>
          )}
        </div>
      </div>

      {/* Processing banner */}
      {invoice.status === 'PROCESSING' && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <div>
            NFS-e em processamento pela prefeitura. A pagina atualiza automaticamente a cada 10 segundos.
          </div>
        </div>
      )}

      {/* Main info cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: Invoice details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Invoice info */}
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="border-b px-6 py-4">
              <h2 className="font-semibold text-gray-900">Dados da NFS-e</h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 flex items-center gap-1"><Hash className="h-3.5 w-3.5" /> Numero</p>
                  <p className="font-medium mt-0.5">{invoice.invoice_number || 'Pendente'}</p>
                </div>
                <div>
                  <p className="text-gray-500 flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Data Emissao</p>
                  <p className="font-medium mt-0.5">
                    {invoice.issued_at ? formatDate(invoice.issued_at) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" /> Valor</p>
                  <p className="font-bold text-lg mt-0.5">{formatCurrency(invoice.total_amount ?? 0)}</p>
                </div>
                <div>
                  <p className="text-gray-500">ISS</p>
                  <p className="font-medium mt-0.5">{formatCurrency(invoice.tax_amount ?? 0)}</p>
                </div>
                {invoice.access_key && (
                  <div className="col-span-2">
                    <p className="text-gray-500">Codigo Verificacao</p>
                    <p className="font-mono text-xs mt-0.5 break-all">{invoice.access_key}</p>
                  </div>
                )}
                {invoice.provider_ref && (
                  <div className="col-span-2">
                    <p className="text-gray-500">Referencia Provedor</p>
                    <p className="font-mono text-xs mt-0.5">{invoice.provider_ref}</p>
                  </div>
                )}
                {invoice.authorized_at && (
                  <div>
                    <p className="text-gray-500">Autorizada em</p>
                    <p className="font-medium mt-0.5">{formatDate(invoice.authorized_at)}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Service items */}
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="border-b px-6 py-4">
              <h2 className="font-semibold text-gray-900">Servicos</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                    <th className="px-6 py-3">Descricao</th>
                    <th className="px-6 py-3">Codigo</th>
                    <th className="px-6 py-3 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoice.invoice_items.map(item => (
                    <tr key={item.id}>
                      <td className="px-6 py-3 text-gray-900">{item.description}</td>
                      <td className="px-6 py-3 text-gray-500">{item.service_code || '—'}</td>
                      <td className="px-6 py-3 text-right font-medium">{formatCurrency(item.total_price)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-gray-50">
                    <td colSpan={2} className="px-6 py-3 text-right font-semibold text-gray-700">Total</td>
                    <td className="px-6 py-3 text-right font-bold text-gray-900">{formatCurrency(invoice.total_amount ?? 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="rounded-lg border bg-white shadow-sm">
              <div className="border-b px-6 py-4">
                <h2 className="font-semibold text-gray-900">Observacoes</h2>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{invoice.notes}</p>
              </div>
            </div>
          )}
        </div>

        {/* Right column: Customer & Actions */}
        <div className="space-y-6">
          {/* Customer */}
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="border-b px-6 py-4">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <User className="h-4 w-4 text-gray-400" />
                Tomador
              </h2>
            </div>
            <div className="p-6 text-sm space-y-2">
              {invoice.customers ? (
                <>
                  <p className="font-medium text-gray-900">{invoice.customers.legal_name}</p>
                  {invoice.customers.document_number && (
                    <p className="text-gray-500">{invoice.customers.document_number}</p>
                  )}
                  {invoice.customers.email && (
                    <p className="text-gray-500">{invoice.customers.email}</p>
                  )}
                  <Link
                    href={`/clientes/${invoice.customers.id}`}
                    className="inline-block mt-2 text-blue-600 hover:underline text-xs"
                  >
                    Ver cadastro do cliente
                  </Link>
                </>
              ) : (
                <p className="text-gray-400">Cliente nao vinculado</p>
              )}
            </div>
          </div>

          {/* Actions */}
          {(invoice.status === 'AUTHORIZED' || invoice.status === 'PROCESSING') && (
            <div className="rounded-lg border bg-white shadow-sm">
              <div className="border-b px-6 py-4">
                <h2 className="font-semibold text-gray-900">Acoes</h2>
              </div>
              <div className="p-6">
                <button
                  type="button"
                  onClick={() => { setCancelJustificativa(''); setShowCancelModal(true) }}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  <XCircle className="h-4 w-4" />
                  Cancelar NFS-e
                </button>
              </div>
            </div>
          )}

          {/* Fiscal Logs */}
          {invoice.fiscal_logs.length > 0 && (
            <div className="rounded-lg border bg-white shadow-sm">
              <div className="border-b px-6 py-4">
                <h2 className="font-semibold text-gray-900">Historico</h2>
              </div>
              <div className="p-4 max-h-64 overflow-y-auto">
                <div className="space-y-3">
                  {invoice.fiscal_logs.map(log => (
                    <div key={log.id} className="flex items-start gap-2 text-xs">
                      <div className={cn(
                        'mt-0.5 h-2 w-2 shrink-0 rounded-full',
                        log.status_code && log.status_code >= 400 ? 'bg-red-400' : 'bg-green-400'
                      )} />
                      <div>
                        <p className="font-medium text-gray-700">{log.action}</p>
                        <p className="text-gray-400">{formatDate(log.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Cancelar NFS-e
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {invoice.invoice_number
                ? `NFS-e #${invoice.invoice_number}`
                : `Ref: ${invoice.provider_ref}`
              } - {invoice.customers?.legal_name}
            </p>

            <div className="mb-4">
              <label htmlFor="detail-cancel-justificativa" className="block text-sm font-medium text-gray-700 mb-1">
                Justificativa do cancelamento
              </label>
              <textarea
                id="detail-cancel-justificativa"
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
                disabled={cancelJustificativa.length < 15 || canceling}
                className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {canceling ? (
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
