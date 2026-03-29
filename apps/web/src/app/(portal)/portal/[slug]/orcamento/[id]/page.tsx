'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

interface OsItem {
  id: string
  description: string
  item_type: string
  quantity: number
  unit_price: number
  total_price: number
}

interface OrcamentoData {
  id: string
  os_number: number
  equipment_type: string
  equipment_brand: string | null
  equipment_model: string | null
  serial_number: string | null
  reported_issue: string
  diagnosis: string | null
  total_cost: number
  total_parts: number
  total_services: number
  status: string
  items: OsItem[]
  customer_name: string
  company: {
    name: string
    phone: string | null
    email: string | null
    whatsapp: string | null
  }
}

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function PortalOrcamentoPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slug = params.slug as string
  const id = params.id as string
  const token = searchParams.get('token')
  const initialAction = searchParams.get('action')

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<OrcamentoData | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ action: string; message: string } | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(initialAction === 'reject')
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    if (!token) {
      setError('Link inválido. Token de acesso não encontrado.')
      setLoading(false)
      return
    }

    fetch(`/api/portal/orcamento/${id}?token=${token}&slug=${slug}`)
      .then(r => {
        if (!r.ok) throw new Error('Link inválido ou expirado')
        return r.json()
      })
      .then(res => {
        if (res.data) setData(res.data)
        else throw new Error('Dados não encontrados')
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id, token, slug])

  async function handleAction(action: 'approve' | 'reject') {
    if (action === 'approve' && !confirm('Confirma a APROVAÇÃO do orçamento? O serviço será iniciado.')) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/portal/orcamento/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, slug, action, reason: action === 'reject' ? rejectReason : undefined }),
      })
      const resData = await res.json()
      if (!res.ok) throw new Error(resData.error || 'Erro ao processar')
      setResult(resData.data)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao processar solicitação')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="mt-3 text-gray-500">Carregando orçamento...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md rounded-lg border bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Link inválido</h2>
          <p className="mt-2 text-sm text-gray-500">{error || 'Não foi possível carregar o orçamento.'}</p>
        </div>
      </div>
    )
  }

  // Result screen
  if (result) {
    const isApproved = result.action === 'approved'
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md rounded-lg border bg-white p-8 text-center shadow-sm">
          <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${isApproved ? 'bg-green-100' : 'bg-red-100'}`}>
            {isApproved ? (
              <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
          <h2 className={`text-xl font-bold ${isApproved ? 'text-green-800' : 'text-red-800'}`}>
            {isApproved ? 'Orçamento Aprovado!' : 'Orçamento Recusado'}
          </h2>
          <p className="mt-2 text-sm text-gray-500">{result.message}</p>
          <div className="mt-6 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
            <p><strong>OS:</strong> OS-{data.os_number}</p>
            <p><strong>Equipamento:</strong> {[data.equipment_type, data.equipment_brand, data.equipment_model].filter(Boolean).join(' ')}</p>
            {isApproved && <p className="mt-2 font-semibold text-green-700">Valor aprovado: {fmtCents(data.total_cost)}</p>}
          </div>
          {data.company.phone && (
            <p className="mt-4 text-xs text-gray-400">
              Dúvidas? Ligue: <a href={`tel:${data.company.phone}`} className="text-blue-600 hover:underline">{data.company.phone}</a>
            </p>
          )}
        </div>
      </div>
    )
  }

  const equipment = [data.equipment_type, data.equipment_brand, data.equipment_model].filter(Boolean).join(' ')
  const services = data.items.filter(i => i.item_type === 'SERVICO')
  const parts = data.items.filter(i => i.item_type !== 'SERVICO')

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-gray-900">{data.company.name}</h1>
          <p className="text-sm text-gray-500">Aprovação de Orçamento</p>
        </div>

        {/* OS Info */}
        <div className="mb-4 rounded-lg border bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">OS-{data.os_number}</h2>
            <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-700">
              {data.status}
            </span>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Cliente</span>
              <span className="font-medium text-gray-900">{data.customer_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Equipamento</span>
              <span className="font-medium text-gray-900">{equipment}</span>
            </div>
            {data.serial_number && (
              <div className="flex justify-between">
                <span className="text-gray-500">Nº Série</span>
                <span className="font-medium text-gray-900">{data.serial_number}</span>
              </div>
            )}
            <div className="border-t pt-3">
              <p className="mb-1 text-gray-500">Defeito relatado</p>
              <p className="text-gray-900">{data.reported_issue}</p>
            </div>
            {data.diagnosis && (
              <div>
                <p className="mb-1 text-gray-500">Diagnóstico</p>
                <p className="text-gray-900">{data.diagnosis}</p>
              </div>
            )}
          </div>
        </div>

        {/* Items Table */}
        {data.items.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-lg border bg-white shadow-sm">
            <div className="border-b p-4">
              <h3 className="font-semibold text-gray-900">Detalhamento do Orçamento</h3>
            </div>

            {services.length > 0 && (
              <>
                <div className="border-b bg-blue-50 px-4 py-2 text-xs font-semibold uppercase text-blue-700">
                  Serviços
                </div>
                <div className="divide-y">
                  {services.map(item => (
                    <div key={item.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.description}</p>
                        <p className="text-xs text-gray-400">Qtd: {item.quantity} x {fmtCents(item.unit_price)}</p>
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{fmtCents(item.total_price)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {parts.length > 0 && (
              <>
                <div className="border-b bg-orange-50 px-4 py-2 text-xs font-semibold uppercase text-orange-700">
                  Peças / Produtos
                </div>
                <div className="divide-y">
                  {parts.map(item => (
                    <div key={item.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.description}</p>
                        <p className="text-xs text-gray-400">Qtd: {item.quantity} x {fmtCents(item.unit_price)}</p>
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{fmtCents(item.total_price)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Total */}
            <div className="border-t-2 border-green-200 bg-green-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-green-800">TOTAL</span>
                <span className="text-2xl font-bold text-green-800">{fmtCents(data.total_cost)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Reject Form */}
        {showRejectForm && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm">
            <h3 className="mb-3 font-semibold text-red-800">Motivo da recusa (opcional)</h3>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Informe o motivo da recusa, se desejar..."
              className="mb-4 w-full rounded-lg border border-red-200 p-3 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
              rows={3}
            />
            <div className="flex gap-3">
              <button
                onClick={() => handleAction('reject')}
                disabled={submitting}
                className="flex-1 rounded-lg bg-red-600 py-3 text-center text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {submitting ? 'Enviando...' : 'CONFIRMAR RECUSA'}
              </button>
              <button
                onClick={() => setShowRejectForm(false)}
                className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {!showRejectForm && (
          <div className="space-y-3">
            <button
              onClick={() => handleAction('approve')}
              disabled={submitting}
              className="w-full rounded-lg bg-green-600 py-4 text-center text-lg font-bold text-white shadow-lg hover:bg-green-700 disabled:opacity-50"
            >
              {submitting ? 'Processando...' : 'APROVAR ORÇAMENTO'}
            </button>
            <button
              onClick={() => setShowRejectForm(true)}
              disabled={submitting}
              className="w-full rounded-lg bg-red-600 py-4 text-center text-lg font-bold text-white shadow-lg hover:bg-red-700 disabled:opacity-50"
            >
              RECUSAR ORÇAMENTO
            </button>
          </div>
        )}

        {/* Contact */}
        <div className="mt-6 rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Dúvidas? Entre em contato</h3>
          <div className="space-y-1 text-sm text-gray-500">
            {data.company.phone && (
              <p>Telefone: <a href={`tel:${data.company.phone}`} className="text-blue-600 hover:underline">{data.company.phone}</a></p>
            )}
            {data.company.email && (
              <p>Email: <a href={`mailto:${data.company.email}`} className="text-blue-600 hover:underline">{data.company.email}</a></p>
            )}
            {data.company.whatsapp && (
              <p>
                <a
                  href={`https://wa.me/${data.company.whatsapp.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-600 hover:underline"
                >
                  WhatsApp
                </a>
              </p>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          {data.company.name} - Aprovação de Orçamento
        </p>
      </div>
    </div>
  )
}
