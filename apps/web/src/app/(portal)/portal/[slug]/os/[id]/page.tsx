'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

interface OSDetail {
  id: string
  os_number: number
  equipment_type: string
  equipment_brand?: string
  equipment_model?: string
  serial_number?: string
  reported_issue: string
  diagnosis?: string
  priority?: string
  os_type?: string
  estimated_cost?: number
  approved_cost?: number
  total_parts?: number
  total_services?: number
  total_cost?: number
  estimated_delivery?: string
  actual_delivery?: string
  warranty_until?: string
  created_at: string
  updated_at: string
  status: { id: string; name: string; color: string; order?: number }
  items: Array<{
    id: string
    item_type: string
    description: string
    quantity: number
    unit_price: number
    total_price: number
  }>
  history: Array<{
    id: string
    to_status: { name: string; color: string }
    notes?: string
    created_at: string
  }>
  photos: Array<{
    id: string
    url: string
    label?: string
  }>
  all_statuses: Array<{
    id: string
    name: string
    color: string
    order?: number
  }>
}

export default function PortalOSDetailPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string
  const osId = params.id as string

  const [os, setOs] = useState<OSDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [company, setCompany] = useState<{ name: string } | null>(null)
  const [customer, setCustomer] = useState<{ name: string } | null>(null)

  const getToken = useCallback(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('portal_token')
  }, [])

  function loadOS() {
    const token = getToken()
    if (!token) {
      router.push(`/portal/${slug}/login`)
      return
    }

    fetch(`/api/portal/os/${osId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (r.status === 401) {
          router.push(`/portal/${slug}/login`)
          return null
        }
        return r.json()
      })
      .then(res => {
        if (res?.data) setOs(res.data)
      })
      .catch(() => toast.error('Erro ao carregar OS'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const savedCompany = localStorage.getItem('portal_company')
    const savedCustomer = localStorage.getItem('portal_customer')
    if (savedCompany) setCompany(JSON.parse(savedCompany))
    if (savedCustomer) setCustomer(JSON.parse(savedCustomer))
    loadOS()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osId])

  async function handleAction(action: 'approve' | 'reject' | 'comment', message?: string) {
    const token = getToken()
    if (!token) return

    setActionLoading(true)
    try {
      const res = await fetch(`/api/portal/os/${osId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, message }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao executar acao')
        return
      }

      toast.success(data.data.message)
      setComment('')
      loadOS()
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setActionLoading(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('portal_token')
    localStorage.removeItem('portal_customer')
    localStorage.removeItem('portal_company')
    router.push(`/portal/${slug}/login`)
  }

  const isAguardandoAprovacao = os?.status.name.toLowerCase().includes('aguardando') &&
    os?.status.name.toLowerCase().includes('aprov')

  const isProntaOuEntregue = os?.status.name.toLowerCase().includes('pronta') ||
    os?.status.name.toLowerCase().includes('entregue')

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!os) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">OS nao encontrada</p>
          <Link href={`/portal/${slug}/os`} className="text-blue-600 hover:text-blue-700">
            Voltar para lista
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900">{company?.name || slug}</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6">
            <Link href={`/portal/${slug}`} className="text-gray-600 hover:text-gray-900 text-sm">Inicio</Link>
            <Link href={`/portal/${slug}/os`} className="text-blue-600 font-medium text-sm">Minhas OS</Link>
            <Link href={`/portal/${slug}/tickets`} className="text-gray-600 hover:text-gray-900 text-sm">Tickets</Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 hidden sm:block">{customer?.name}</span>
            <button onClick={handleLogout} className="text-sm text-red-600 hover:text-red-700 font-medium">Sair</button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link href={`/portal/${slug}/os`} className="hover:text-gray-700">Minhas OS</Link>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-900 font-medium">OS #{os.os_number}</span>
        </div>

        {/* OS Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">OS #{os.os_number}</h1>
              <p className="text-gray-500 mt-1">
                Aberta em {new Date(os.created_at).toLocaleDateString('pt-BR', {
                  day: '2-digit', month: 'long', year: 'numeric'
                })}
              </p>
            </div>
            <span
              className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold self-start"
              style={{
                backgroundColor: `${os.status.color}20`,
                color: os.status.color,
              }}
            >
              {os.status.name}
            </span>
          </div>

          {/* Status Timeline */}
          {os.all_statuses.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Progresso</h3>
              <div className="flex items-center overflow-x-auto pb-2">
                {os.all_statuses.map((s, i) => {
                  const currentOrder = os.status.order ?? 0
                  const statusOrder = s.order ?? 0
                  const isActive = s.id === os.status.id
                  const isPast = statusOrder < currentOrder
                  const isFuture = statusOrder > currentOrder

                  return (
                    <div key={s.id} className="flex items-center flex-shrink-0">
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                            isActive
                              ? 'ring-4 ring-offset-2'
                              : ''
                          }`}
                          style={{
                            backgroundColor: isPast || isActive ? s.color : '#E5E7EB',
                            color: isPast || isActive ? 'white' : '#9CA3AF',
                            boxShadow: isActive ? `0 0 0 3px ${s.color}40` : undefined,
                          }}
                        >
                          {isPast ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            i + 1
                          )}
                        </div>
                        <span
                          className={`text-xs mt-1 max-w-[80px] text-center leading-tight ${
                            isActive ? 'font-semibold text-gray-900' : isFuture ? 'text-gray-400' : 'text-gray-600'
                          }`}
                        >
                          {s.name}
                        </span>
                      </div>
                      {i < os.all_statuses.length - 1 && (
                        <div
                          className={`w-8 h-1 mx-1 rounded ${
                            isPast ? 'bg-green-400' : 'bg-gray-200'
                          }`}
                          style={isPast ? { backgroundColor: s.color } : undefined}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Equipment Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">Equipamento</h3>
              <p className="text-gray-900 font-medium">{os.equipment_type}</p>
              {(os.equipment_brand || os.equipment_model) && (
                <p className="text-gray-600 text-sm">
                  {os.equipment_brand} {os.equipment_model}
                </p>
              )}
              {os.serial_number && (
                <p className="text-gray-500 text-sm">S/N: {os.serial_number}</p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">Problema Relatado</h3>
              <p className="text-gray-700">{os.reported_issue}</p>
            </div>
            {os.diagnosis && (
              <div className="sm:col-span-2">
                <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">Diagnostico</h3>
                <p className="text-gray-700">{os.diagnosis}</p>
              </div>
            )}
            {os.estimated_delivery && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">Previsao de Entrega</h3>
                <p className="text-gray-900">{new Date(os.estimated_delivery).toLocaleDateString('pt-BR')}</p>
              </div>
            )}
            {os.warranty_until && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">Garantia ate</h3>
                <p className="text-gray-900">{new Date(os.warranty_until).toLocaleDateString('pt-BR')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons for approval */}
        {isAguardandoAprovacao && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6">
            <h3 className="font-semibold text-amber-900 text-lg mb-2">Orcamento aguardando aprovacao</h3>
            <p className="text-amber-700 mb-4">
              Valor total: <strong className="text-xl">R$ {((os.total_cost || 0) / 100).toFixed(2)}</strong>
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => handleAction('approve', 'Aprovado pelo cliente')}
                disabled={actionLoading}
                className="flex-1 py-3 px-6 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold rounded-xl transition-colors"
              >
                Aprovar Orcamento
              </button>
              <button
                onClick={() => {
                  const reason = prompt('Motivo da negociacao (opcional):')
                  handleAction('reject', reason || 'Cliente solicitou negociacao')
                }}
                disabled={actionLoading}
                className="flex-1 py-3 px-6 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold rounded-xl transition-colors"
              >
                Negociar
              </button>
            </div>
          </div>
        )}

        {/* Items table */}
        {os.items.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 mb-6 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Itens do Orcamento</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Tipo</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Descricao</th>
                    <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Qtd</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Unit.</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {os.items.map(item => (
                    <tr key={item.id}>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          item.item_type === 'PECA'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}>
                          {item.item_type === 'PECA' ? 'Peca' : 'Servico'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-900">{item.description}</td>
                      <td className="px-5 py-3 text-center text-gray-600">{item.quantity}</td>
                      <td className="px-5 py-3 text-right text-gray-600">
                        R$ {(item.unit_price / 100).toFixed(2)}
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-gray-900">
                        R$ {(item.total_price / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={4} className="px-5 py-3 text-right font-semibold text-gray-700">
                      Total
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-gray-900 text-lg">
                      R$ {((os.total_cost || 0) / 100).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Payment section */}
        {isProntaOuEntregue && os.total_cost && os.total_cost > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 mb-6 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Pagamento</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* PIX */}
              <div className="border border-gray-200 rounded-xl p-4 text-center">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="font-medium text-gray-900 mb-1">PIX</h3>
                <p className="text-sm text-gray-500 mb-3">Pagamento instantaneo</p>
                <div className="bg-gray-100 rounded-lg p-4 mb-2">
                  <p className="text-xs text-gray-400">QR Code PIX</p>
                  <p className="text-xs text-gray-400">(Em breve)</p>
                </div>
              </div>

              {/* Boleto */}
              <div className="border border-gray-200 rounded-xl p-4 text-center">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="font-medium text-gray-900 mb-1">Boleto</h3>
                <p className="text-sm text-gray-500 mb-3">Vencimento em 3 dias</p>
                <button className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
                  Gerar Boleto
                </button>
              </div>

              {/* Cartao */}
              <div className="border border-gray-200 rounded-xl p-4 text-center">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <h3 className="font-medium text-gray-900 mb-1">Cartao</h3>
                <p className="text-sm text-gray-500 mb-3">Credito ou debito</p>
                <button className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors">
                  Pagar com Cartao
                </button>
              </div>
            </div>
          </div>
        )}

        {/* History */}
        {os.history.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 mb-6">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Historico</h2>
            </div>
            <div className="p-5">
              <div className="space-y-4">
                {os.history.map((h, i) => (
                  <div key={h.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0 mt-1.5"
                        style={{ backgroundColor: h.to_status.color }}
                      />
                      {i < os.history.length - 1 && (
                        <div className="w-0.5 flex-1 bg-gray-200 mt-1" />
                      )}
                    </div>
                    <div className="pb-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          style={{
                            backgroundColor: `${h.to_status.color}20`,
                            color: h.to_status.color,
                          }}
                        >
                          {h.to_status.name}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(h.created_at).toLocaleDateString('pt-BR', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                      </div>
                      {h.notes && (
                        <p className="text-sm text-gray-600 mt-1">{h.notes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Comment */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Enviar Comentario</h2>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Digite sua mensagem..."
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 placeholder-gray-400 resize-none"
          />
          <div className="flex justify-end mt-3">
            <button
              onClick={() => handleAction('comment', comment)}
              disabled={actionLoading || !comment.trim()}
              className="py-2.5 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium rounded-xl transition-colors"
            >
              {actionLoading ? 'Enviando...' : 'Enviar'}
            </button>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs text-gray-400">
          Powered by PontualERP
        </div>
      </footer>
    </div>
  )
}
