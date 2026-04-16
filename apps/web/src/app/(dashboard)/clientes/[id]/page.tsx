'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Pencil, Trash2, DollarSign, Download, Printer, Loader2, RefreshCw, FileText, MessageCircle } from 'lucide-react'
import { formatDocument } from '@/lib/utils'
import { toTitleCase as tc } from '@/lib/format-text'
import { toast } from 'sonner'

interface Cliente {
  id: string
  legal_name: string
  trade_name: string | null
  person_type: string
  customer_type: string
  document_number: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  address_street: string | null
  address_number: string | null
  address_complement: string | null
  address_neighborhood: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  notes: string | null
  created_at: string
}

interface OS {
  id: string
  os_number: string
  status: string
  status_id: string
  module_statuses?: { name: string; color: string | null }
  reported_issue: string | null
  total_amount: number
  created_at: string
}

interface ContaReceber {
  id: string
  description: string
  total_amount: number
  received_amount: number
  due_date: string
  status: string
  payment_method: string | null
  boleto_url: string | null
  pix_code: string | null
  service_order_id: string | null
}

function safeDate(v: any, utc = false): string {
  if (!v) return '--'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '--'
  return d.toLocaleDateString('pt-BR', utc ? { timeZone: 'UTC' } : undefined)
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function ClienteDetalhePage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [ordens, setOrdens] = useState<OS[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [contas, setContas] = useState<ContaReceber[]>([])
  const [gerando, setGerando] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/clientes/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        const data = d.data ?? d
        setCliente(data)
        setOrdens(data.service_orders ?? [])
      })
      .catch(() => setError('Erro ao carregar cliente'))
      .finally(() => setLoading(false))

    // Carregar contas a receber do cliente
    fetch(`/api/financeiro/contas-receber?customer_id=${id}&limit=50`)
      .then(r => r.json())
      .then(d => setContas(d.data ?? []))
      .catch(() => {})
  }, [id])

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/clientes/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao excluir')
      }
      toast.success('Cliente excluído')
      router.push('/clientes')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-gray-400">Carregando...</div>
  }

  if (error || !cliente) {
    return (
      <div className="py-12 text-center">
        <p className="text-red-500">{error || 'Cliente não encontrado'}</p>
        <Link href="/clientes" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          Voltar para clientes
        </Link>
      </div>
    )
  }

  const endereco = [
    cliente.address_street,
    cliente.address_number,
    cliente.address_complement,
    cliente.address_neighborhood,
    cliente.address_city && cliente.address_state
      ? `${cliente.address_city}/${cliente.address_state}`
      : cliente.address_city,
    cliente.address_zip,
  ].filter(Boolean).join(', ')

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/clientes" className="rounded-md border p-2 hover:bg-gray-50">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{tc(cliente.legal_name || '')}</h1>
            {cliente.trade_name && <p className="text-sm text-gray-500">{cliente.trade_name}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => router.push(`/clientes/${id}/editar`)}
            className="flex items-center gap-2 px-4 py-2 text-sm border rounded-md hover:bg-gray-50 text-gray-700 font-medium">
            <Pencil className="h-4 w-4" /> Editar
          </button>
          <button type="button" onClick={() => setShowDeleteModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-red-200 rounded-md hover:bg-red-50 text-red-600 font-medium">
            <Trash2 className="h-4 w-4" /> Excluir
          </button>
        </div>
      </div>

      {/* Client data */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Identificação</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Tipo</span>
              <span className="text-gray-900">{cliente.person_type === 'FISICA' ? 'Pessoa Física' : 'Pessoa Jurídica'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Classificação</span>
              <span className="text-gray-900">{cliente.customer_type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{cliente.person_type === 'FISICA' ? 'CPF' : 'CNPJ'}</span>
              <span className="text-gray-900">{formatDocument(cliente.document_number)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Cadastrado em</span>
              <span className="text-gray-900">{new Date(cliente.created_at).toLocaleDateString('pt-BR')}</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Contato</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Email</span>
              <span className="text-gray-900">{cliente.email || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Celular</span>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-900">{cliente.mobile || '—'}</span>
                {cliente.mobile && (
                  <a href={`https://wa.me/${(() => { const d = cliente.mobile.replace(/\D/g, ''); return d.startsWith('55') ? d : '55' + d })()}`}
                    target="_blank" rel="noopener noreferrer" title="WhatsApp"
                    className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-green-500 hover:bg-green-600 transition-colors">
                    <MessageCircle className="h-3 w-3 text-white" />
                  </a>
                )}
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Telefone</span>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-900">{cliente.phone || '—'}</span>
                {cliente.phone && (
                  <a href={`https://wa.me/${(() => { const d = cliente.phone.replace(/\D/g, ''); return d.startsWith('55') ? d : '55' + d })()}`}
                    target="_blank" rel="noopener noreferrer" title="WhatsApp"
                    className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-green-500 hover:bg-green-600 transition-colors">
                    <MessageCircle className="h-3 w-3 text-white" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {endereco && (
        <div className="rounded-lg border bg-white p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Endereço</h2>
          <p className="text-sm text-gray-700">{endereco}</p>
        </div>
      )}

      {cliente.notes && (
        <div className="rounded-lg border bg-white p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Observações</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{cliente.notes}</p>
        </div>
      )}

      {/* Service Orders */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Ordens de Serviço</h2>
          <Link href={`/os/novo?cliente=${id}`}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
            Nova OS
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-4 py-3">Número</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Problema</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ordens.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Nenhuma OS encontrada</td></tr>
              ) : (
                ordens.map(os => (
                  <tr key={os.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/os/${os.id}`} className="font-medium text-blue-600 hover:underline">
                        #{os.os_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: os.module_statuses?.color || '#6B7280' }}
                      >
                        {os.module_statuses?.name || os.status || 'Sem status'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{os.reported_issue || '—'}</td>
                    <td className="px-4 py-3 font-medium">{formatCurrency(os.total_amount || 0)}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(os.created_at).toLocaleDateString('pt-BR')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Financeiro — Contas a Receber */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-600" />
            Financeiro
          </h2>
          <span className="text-xs text-gray-400">{contas.length} conta(s)</span>
        </div>

        {contas.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 text-sm">Nenhuma conta a receber para este cliente</div>
        ) : (
          <div className="divide-y">
            {contas.map(c => {
              let meta: any = null
              try { if (c.pix_code) meta = JSON.parse(c.pix_code) } catch {}
              const hasBoleto = !!c.boleto_url
              const isPaid = c.status === 'RECEBIDO'
              const isOverdue = c.status === 'PENDENTE' && new Date(c.due_date) < new Date()

              return (
                <div key={c.id} className="px-5 py-4 space-y-2">
                  {/* Linha principal */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <Link href={`/financeiro/contas-receber/${c.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600">
                        {c.description}
                      </Link>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                        <span>Venc: {safeDate(c.due_date, true)}</span>
                        <span>{c.payment_method || '--'}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{formatCurrency(c.total_amount)}</p>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        isPaid ? 'bg-green-100 text-green-700'
                        : isOverdue ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                      }`}>
                        {isPaid ? 'Pago' : isOverdue ? 'Vencido' : 'Pendente'}
                      </span>
                    </div>
                  </div>

                  {/* Status do boleto + ações */}
                  {hasBoleto && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <FileText className="h-3.5 w-3.5 text-orange-500" />
                      <span>Banco Inter — CNAB 400</span>
                      <span className="text-gray-300">|</span>
                      <span>{meta?.boletoStatus === 'PAID' ? 'Pago' : meta?.boletoStatus === 'REGISTRANDO' ? 'Aguardando envio ao banco' : meta?.boletoStatus || 'Processando'}</span>
                      {meta?.generatedAt && (
                        <>
                          <span className="text-gray-300">|</span>
                          <span>Emitido: {safeDate(meta.generatedAt)}</span>
                        </>
                      )}
                    </div>
                  )}

                  {/* Botões de ação */}
                  {!isPaid && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={gerando === c.id} onClick={async () => {
                        setGerando(c.id)
                        try {
                          const res = await fetch(`/api/financeiro/cnab?ids=${c.id}`)
                          if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
                          const blob = await res.blob()
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a'); a.href = url
                          a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'remessa.rem'
                          a.click(); URL.revokeObjectURL(url)
                          toast.success('Remessa gerada!')
                          // Reload contas
                          fetch(`/api/financeiro/contas-receber?customer_id=${id}&limit=50`).then(r => r.json()).then(d => setContas(d.data ?? []))
                        } catch (err: any) { toast.error(err.message || 'Erro') }
                        finally { setGerando(null) }
                      }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50">
                        {gerando === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {hasBoleto ? 'Reenviar Remessa' : 'Gerar Remessa CNAB'}
                      </button>
                      <button type="button" onClick={() => window.open(`/boleto-print?ids=${c.id}`, '_blank')}
                        className="inline-flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-900">
                        <Printer className="h-3.5 w-3.5" /> Imprimir Boleto
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteModal(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Excluir cliente?</h2>
            <p className="text-sm text-gray-600 mb-4">
              Tem certeza que deseja excluir <strong>{tc(cliente.legal_name || '')}</strong>? Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
