'use client'

import { Suspense, useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

interface OsItem {
  id: string; description: string; item_type: string
  quantity: number; unit_price: number; total_price: number
}

interface OrcamentoData {
  id: string; os_number: number
  equipment_type: string; equipment_brand: string | null; equipment_model: string | null
  serial_number: string | null; reported_issue: string; diagnosis: string | null
  total_cost: number; total_parts: number; total_services: number
  status: string; items: OsItem[]; customer_name: string
  customer_person_type: string
  quote_version: number | null
  company: { name: string; phone: string | null; email: string | null; whatsapp: string | null }
}

function fmt(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function PortalOrcamentoPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gray-50"><div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>}>
      <OrcamentoContent />
    </Suspense>
  )
}

function OrcamentoContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slug = params.slug as string
  const id = params.id as string
  const token = searchParams.get('token')

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<OrcamentoData | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ action: string; message: string } | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [showCounterOffer, setShowCounterOffer] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [showApproveForm, setShowApproveForm] = useState(false)
  const [applyDiscount, setApplyDiscount] = useState(false)

  const DISCOUNT_PERCENT = 10

  useEffect(() => {
    if (!token) { setError('Link invalido. Token de acesso nao encontrado.'); setLoading(false); return }
    fetch(`/api/portal/orcamento/${id}?token=${token}&slug=${slug}`)
      .then(r => { if (!r.ok) throw new Error('Link invalido ou expirado'); return r.json() })
      .then(res => { if (res.data) setData(res.data); else throw new Error('Dados nao encontrados') })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id, token, slug])

  async function handleAction(action: 'approve' | 'reject') {
    if (action === 'approve' && !paymentMethod) { alert('Selecione a forma de pagamento'); return }
    setSubmitting(true)
    try {
      const discountedCost = applyDiscount && data ? Math.round(data.total_cost * (1 - DISCOUNT_PERCENT / 100)) : undefined
      const res = await fetch(`/api/portal/orcamento/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token, slug, action,
          reason: action === 'reject' ? rejectReason : undefined,
          payment_method: action === 'approve' ? paymentMethod : undefined,
          discounted_cost: action === 'approve' && applyDiscount ? discountedCost : undefined,
          discount_percent: action === 'approve' && applyDiscount ? DISCOUNT_PERCENT : undefined,
        }),
      })
      const resData = await res.json()
      if (!res.ok) throw new Error(resData.error || 'Erro ao processar')
      setResult(resData.data)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao processar')
    } finally { setSubmitting(false) }
  }

  const whatsappUrl = data?.company?.whatsapp ? `https://wa.me/${data.company.whatsapp.replace(/\D/g, '')}` : 'https://wa.me/551126263841'

  // Loading
  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-3 border-blue-600 border-t-transparent" />
        <p className="mt-4 text-sm text-gray-500">Carregando orcamento...</p>
      </div>
    </div>
  )

  // Error
  if (error || !data) return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
          <span className="text-2xl">⚠️</span>
        </div>
        <h2 className="text-lg font-bold text-gray-900">Link invalido</h2>
        <p className="mt-2 text-sm text-gray-500">{error || 'Nao foi possivel carregar o orcamento.'}</p>
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-sm font-semibold text-white hover:bg-green-700">
          Falar com Suporte
        </a>
      </div>
    </div>
  )

  // Result
  if (result) {
    const isApproved = result.action === 'approved'
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 p-4">
        <div className="w-full max-w-md rounded-2xl border bg-white shadow-lg overflow-hidden">
          <div className={`p-8 text-center ${isApproved ? 'bg-gradient-to-b from-green-50 to-white' : 'bg-gradient-to-b from-red-50 to-white'}`}>
            <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${isApproved ? 'bg-green-100' : 'bg-red-100'}`}>
              <span className="text-3xl">{isApproved ? '✅' : '📋'}</span>
            </div>
            <h2 className={`text-xl font-bold ${isApproved ? 'text-green-800' : 'text-red-800'}`}>
              {isApproved ? 'Orcamento Aprovado!' : 'Orcamento Recusado'}
            </h2>
            <p className="mt-2 text-sm text-gray-500">{result.message}</p>
          </div>

          <div className="p-6 space-y-4">
            <div className="rounded-lg bg-gray-50 p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">OS</span>
                <span className="font-bold text-gray-900">#{data.os_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Equipamento</span>
                <span className="font-medium text-gray-900">{[data.equipment_type, data.equipment_brand, data.equipment_model].filter(Boolean).join(' ')}</span>
              </div>
              {isApproved && (
                <div className="flex justify-between pt-2 border-t">
                  <span className="text-gray-500">Valor aprovado</span>
                  <span className="font-bold text-green-700 text-lg">
                    {applyDiscount ? fmt(Math.round(data.total_cost * (1 - DISCOUNT_PERCENT / 100))) : fmt(data.total_cost)}
                  </span>
                </div>
              )}
            </div>

            {isApproved && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800">
                <p className="font-semibold mb-1">Proximo passo</p>
                <p>Nossa equipe tecnica ja foi notificada e o reparo comeca agora. Voce recebera um aviso quando estiver pronto.</p>
              </div>
            )}

            {!isApproved && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                <p className="font-semibold mb-1">Quer negociar?</p>
                <p>Entre em contato pelo WhatsApp que revisamos o orcamento.</p>
              </div>
            )}

            <div className="flex gap-3">
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
                className="flex-1 rounded-lg bg-green-600 py-3 text-center text-sm font-semibold text-white hover:bg-green-700">
                WhatsApp Suporte
              </a>
              <button type="button" onClick={() => window.close()}
                className="flex-1 rounded-lg border border-gray-300 py-3 text-center text-sm font-medium text-gray-700 hover:bg-gray-50">
                Fechar
              </button>
            </div>
          </div>

          <div className="border-t px-6 py-4 text-center space-y-1">
            <p className="text-xs font-medium text-gray-500">{data.company.name}</p>
            {data.company.phone && <p className="text-xs text-gray-400">Tel: {data.company.phone}</p>}
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-green-600 font-medium hover:text-green-700">
              Fale com nosso suporte
            </a>
          </div>
        </div>
      </div>
    )
  }

  const equipment = [data.equipment_type, data.equipment_brand, data.equipment_model].filter(Boolean).join(' ')
  const services = data.items.filter(i => i.item_type === 'SERVICO')
  const parts = data.items.filter(i => i.item_type !== 'SERVICO')
  const maxInstallments = 3
  const installmentValue = fmt(Math.ceil(data.total_cost / maxInstallments))

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-4 pb-8">
      <div className="mx-auto max-w-2xl">

        {/* Header */}
        <div className="mb-6 rounded-2xl bg-white border shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-center text-white">
            <h1 className="text-xl font-bold">{data.company.name}</h1>
            <p className="mt-1 text-blue-200 text-sm">Orcamento Tecnico</p>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-gray-500">Ordem de Servico</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold text-gray-900">#{data.os_number}</p>
                  {data.quote_version && (
                    <span className="rounded-full bg-indigo-100 border border-indigo-300 px-2.5 py-0.5 text-xs font-bold text-indigo-700">
                      v{data.quote_version}
                    </span>
                  )}
                </div>
              </div>
              <span className="rounded-full bg-amber-100 border border-amber-300 px-3 py-1 text-xs font-bold text-amber-800">
                {data.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-400 text-xs uppercase">Cliente</p>
                <p className="font-medium text-gray-900">{data.customer_name}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs uppercase">Equipamento</p>
                <p className="font-medium text-gray-900">{equipment}</p>
              </div>
              {data.serial_number && (
                <div>
                  <p className="text-gray-400 text-xs uppercase">N Serie</p>
                  <p className="font-mono text-gray-900">{data.serial_number}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Laudo */}
        <div className="mb-4 rounded-2xl border bg-white p-6 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Laudo Tecnico</h3>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-gray-400 text-xs uppercase mb-1">Problema relatado</p>
              <p className="text-gray-900">{data.reported_issue}</p>
            </div>
            {data.diagnosis && (
              <div className="border-t pt-3">
                <p className="text-gray-400 text-xs uppercase mb-1">Laudo</p>
                <p className="text-gray-900">{data.diagnosis}</p>
              </div>
            )}
          </div>
        </div>

        {/* Items */}
        {data.items.length > 0 && (
          <div className="mb-4 rounded-2xl border bg-white shadow-sm overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Detalhamento</h3>
            </div>

            {services.length > 0 && (
              <>
                <div className="bg-blue-50 px-4 py-2 text-xs font-bold uppercase text-blue-700 border-b">
                  Servicos
                </div>
                <div className="divide-y">
                  {services.map(item => (
                    <div key={item.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.description}</p>
                        <p className="text-xs text-gray-400">{item.quantity}x {fmt(item.unit_price)}</p>
                      </div>
                      <p className="text-sm font-bold text-gray-900">{fmt(item.total_price)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {parts.length > 0 && (
              <>
                <div className="bg-purple-50 px-4 py-2 text-xs font-bold uppercase text-purple-700 border-b border-t">
                  Pecas e Componentes
                </div>
                <div className="divide-y">
                  {parts.map(item => (
                    <div key={item.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.description}</p>
                        <p className="text-xs text-gray-400">{item.quantity}x {fmt(item.unit_price)}</p>
                      </div>
                      <p className="text-sm font-bold text-gray-900">{fmt(item.total_price)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Total + Parcelas */}
        <div className="mb-4 rounded-2xl overflow-hidden shadow-lg">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-center text-white">
            <p className="text-3xl font-extrabold">{maxInstallments}x de {installmentValue}</p>
            <p className="mt-1 text-blue-200 text-sm">sem juros no cartao de credito</p>
            <p className="mt-2 text-blue-300 text-xs">Valor total: {fmt(data.total_cost)}</p>
          </div>
        </div>

        {/* Counter-Offer */}
        {showCounterOffer && data && (() => {
          const discountedPrice = Math.round(data.total_cost * (1 - DISCOUNT_PERCENT / 100))
          const discountInstallmentValue = fmt(Math.ceil(discountedPrice / maxInstallments))
          return (
            <div className="mb-4 rounded-2xl border-2 border-amber-300 bg-gradient-to-b from-amber-50 to-white p-6 shadow-lg">
              <div className="text-center mb-5">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
                  <span className="text-2xl">💡</span>
                </div>
                <h3 className="text-lg font-bold text-gray-900">Entendemos sua preocupacao!</h3>
                <p className="text-sm text-gray-500 mt-1">Que tal um desconto especial para fechar agora?</p>
              </div>

              <div className="rounded-xl bg-white border-2 border-green-200 p-5 mb-5 text-center shadow-sm">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Oferta exclusiva</p>
                <p className="text-lg text-gray-400 line-through">{fmt(data.total_cost)}</p>
                <p className="text-3xl font-extrabold text-green-600 mt-1">{fmt(discountedPrice)}</p>
                <span className="inline-block mt-2 rounded-full bg-green-100 border border-green-300 px-3 py-1 text-xs font-bold text-green-700">
                  {DISCOUNT_PERCENT}% DE DESCONTO
                </span>
                <p className="text-sm text-gray-500 mt-3">ou {maxInstallments}x de {discountInstallmentValue} sem juros</p>
              </div>

              <div className="space-y-3">
                <button type="button"
                  onClick={() => {
                    setApplyDiscount(true)
                    setShowCounterOffer(false)
                    setShowApproveForm(true)
                  }}
                  className="w-full rounded-xl bg-green-600 py-4 text-base font-bold text-white shadow-lg hover:bg-green-700 transition-colors">
                  Aceitar com desconto
                </button>
                <button type="button"
                  onClick={() => {
                    setShowCounterOffer(false)
                    setShowRejectForm(true)
                  }}
                  className="w-full rounded-xl border-2 border-red-300 bg-white py-3 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors">
                  Recusar mesmo assim
                </button>
                <button type="button"
                  onClick={() => setShowCounterOffer(false)}
                  className="w-full rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors">
                  Voltar
                </button>
              </div>
            </div>
          )
        })()}

        {/* Reject Form */}
        {showRejectForm && (
          <div className="mb-4 rounded-2xl border-2 border-red-200 bg-red-50 p-6 shadow-sm">
            <h3 className="mb-3 font-bold text-red-800">Motivo da recusa (opcional)</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Informe o motivo, se desejar..."
              className="mb-4 w-full rounded-lg border border-red-200 p-3 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
              rows={3} />
            <div className="flex gap-3">
              <button type="button" onClick={() => handleAction('reject')} disabled={submitting}
                className="flex-1 rounded-lg bg-red-600 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">
                {submitting ? 'Enviando...' : 'Confirmar Recusa'}
              </button>
              <button type="button" onClick={() => setShowRejectForm(false)}
                className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* Approve Form — selecionar pagamento */}
        {showApproveForm && !showRejectForm && data && (() => {
          const displayCost = applyDiscount ? Math.round(data.total_cost * (1 - DISCOUNT_PERCENT / 100)) : data.total_cost
          return (
          <div className="mb-4 rounded-2xl border-2 border-green-200 bg-green-50 p-6 shadow-sm">
            {applyDiscount && (
              <div className="mb-4 rounded-lg bg-green-100 border border-green-300 p-3 text-center">
                <p className="text-xs text-green-700 font-bold uppercase tracking-wide">Desconto de {DISCOUNT_PERCENT}% aplicado!</p>
                <p className="text-sm text-gray-500 line-through">{fmt(data.total_cost)}</p>
                <p className="text-xl font-extrabold text-green-700">{fmt(displayCost)}</p>
              </div>
            )}
            <h3 className="mb-2 font-bold text-green-800">Como deseja pagar?</h3>
            <p className="text-xs text-gray-500 mb-4">O pagamento sera realizado no momento da entrega do equipamento.</p>

            <div className="space-y-3 mb-4">
              {/* PIX */}
              <button type="button" onClick={() => setPaymentMethod('PIX')}
                className={`w-full rounded-lg border-2 p-4 text-left transition-all ${paymentMethod === 'PIX' ? 'border-green-500 bg-green-100' : 'border-gray-200 bg-white hover:border-green-300'}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold text-gray-900">⚡ PIX</p><p className="text-xs text-gray-500">Pagamento a vista na entrega</p></div>
                  <p className="text-lg font-bold text-green-700">{fmt(displayCost)}</p>
                </div>
              </button>

              {/* Dinheiro */}
              <button type="button" onClick={() => setPaymentMethod('Dinheiro')}
                className={`w-full rounded-lg border-2 p-4 text-left transition-all ${paymentMethod === 'Dinheiro' ? 'border-green-500 bg-green-100' : 'border-gray-200 bg-white hover:border-green-300'}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold text-gray-900">💵 Dinheiro</p><p className="text-xs text-gray-500">Pagamento a vista na entrega</p></div>
                  <p className="text-lg font-bold text-green-700">{fmt(displayCost)}</p>
                </div>
              </button>

              {/* Cartão Crédito com dropdown */}
              <div className={`rounded-lg border-2 p-4 transition-all ${paymentMethod.startsWith('Cartao Credito') ? 'border-green-500 bg-green-100' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold text-gray-900">💳 Cartao de Credito</p><p className="text-xs text-gray-500">Ate 3x sem juros na entrega</p></div>
                  <select title="Parcelas" value={paymentMethod.startsWith('Cartao Credito') ? paymentMethod : ''}
                    onChange={e => { if (e.target.value) setPaymentMethod(e.target.value) }}
                    className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-gray-700">
                    <option value="">Parcelas</option>
                    <option value="Cartao Credito 1x">1x de {fmt(displayCost)}</option>
                    <option value="Cartao Credito 2x">2x de {fmt(Math.ceil(displayCost / 2))}</option>
                    <option value="Cartao Credito 3x">3x de {fmt(Math.ceil(displayCost / 3))}</option>
                  </select>
                </div>
              </div>

              {/* Cartão Débito */}
              <button type="button" onClick={() => setPaymentMethod('Cartao Debito')}
                className={`w-full rounded-lg border-2 p-4 text-left transition-all ${paymentMethod === 'Cartao Debito' ? 'border-green-500 bg-green-100' : 'border-gray-200 bg-white hover:border-green-300'}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold text-gray-900">💳 Cartao de Debito</p><p className="text-xs text-gray-500">Pagamento a vista na entrega</p></div>
                  <p className="text-lg font-bold text-green-700">{fmt(displayCost)}</p>
                </div>
              </button>

              {/* Boleto — só PJ */}
              {data.customer_person_type === 'JURIDICA' && (
                <button type="button" onClick={() => setPaymentMethod('Boleto 7 dias')}
                  className={`w-full rounded-lg border-2 p-4 text-left transition-all ${paymentMethod === 'Boleto 7 dias' ? 'border-green-500 bg-green-100' : 'border-gray-200 bg-white hover:border-green-300'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">🏦 Boleto Bancario</p>
                      <p className="text-xs text-gray-500">Vencimento em 7 dias — sujeito a analise de credito</p>
                    </div>
                    <p className="text-lg font-bold text-green-700">{fmt(displayCost)}</p>
                  </div>
                </button>
              )}
            </div>

            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 mb-4">
              <p className="text-xs text-blue-800 font-medium">Importante: o pagamento sera realizado no momento da entrega/retirada do equipamento.</p>
            </div>

            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 mb-4">
              <p className="text-sm font-semibold text-blue-800 mb-1">📅 Previsao de entrega</p>
              <p className="text-xs text-blue-700">Ate <strong>10 dias uteis</strong> a partir da aprovacao. Sempre tentamos entregar o quanto antes!</p>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => handleAction('approve')} disabled={submitting || !paymentMethod}
                className="flex-1 rounded-lg bg-green-600 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
                {submitting ? 'Processando...' : '✅ Confirmar Aprovacao'}
              </button>
              <button type="button" onClick={() => { setShowApproveForm(false); setApplyDiscount(false); setPaymentMethod('') }}
                className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Voltar
              </button>
            </div>
          </div>
          )
        })()}

        {/* Action Buttons */}
        {!showRejectForm && !showApproveForm && !showCounterOffer && (() => {
          const st = (data.status || '').toLowerCase()
          const podeAprovar = st.includes('aguardando aprov') || st.includes('recusad')
          const valorValido = data.total_cost > 0

          if (!podeAprovar) {
            return (
              <div className="mb-6 rounded-2xl bg-gray-100 p-6 text-center">
                <p className="text-sm text-gray-500">Este orcamento nao esta disponivel para aprovacao no momento.</p>
                <p className="text-xs text-gray-400 mt-1">Status atual: {data.status}</p>
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700">
                  Falar com Suporte
                </a>
              </div>
            )
          }

          if (!valorValido) {
            return (
              <div className="mb-6 rounded-2xl bg-amber-50 border border-amber-200 p-6 text-center">
                <p className="text-sm text-amber-800 font-medium">Orcamento ainda sem valor definido.</p>
                <p className="text-xs text-amber-600 mt-1">Aguarde a equipe tecnica finalizar o laudo e definir o valor.</p>
              </div>
            )
          }

          return (
            <div className="space-y-3 mb-6">
              <button type="button" onClick={() => setShowApproveForm(true)} disabled={submitting}
                className="w-full rounded-2xl bg-green-600 py-4 text-lg font-bold text-white shadow-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                ✅ Aprovar Orcamento
              </button>
              <button type="button" onClick={() => setShowCounterOffer(true)} disabled={submitting}
                className="w-full rounded-2xl border-2 border-red-300 bg-white py-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
                Recusar Orcamento
              </button>
            </div>
          )
        })()}

        {/* WhatsApp Suporte — flutuante elegante */}
        <div className="fixed bottom-6 right-6 z-50">
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-full bg-green-500 pl-5 pr-6 py-3 text-sm font-semibold text-white shadow-2xl hover:bg-green-600 transition-all hover:scale-105">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.611.611l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.387 0-4.594-.838-6.32-2.234l-.144-.113-3.147 1.055 1.055-3.147-.113-.144A9.935 9.935 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
            </svg>
            Suporte
          </a>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center space-y-2">
          <p className="text-sm font-semibold text-gray-700">{data.company.name}</p>
          <p className="text-xs text-gray-400">Assistencia Tecnica em Informatica</p>
          {data.company.phone && (
            <p className="text-xs text-gray-500">
              Tel: <a href={`tel:${data.company.phone}`} className="hover:text-blue-600">{data.company.phone}</a>
            </p>
          )}
          {data.company.email && (
            <p className="text-xs text-gray-500">{data.company.email}</p>
          )}
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-green-600 font-medium hover:text-green-700">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.611.611l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.387 0-4.594-.838-6.32-2.234l-.144-.113-3.147 1.055 1.055-3.147-.113-.144A9.935 9.935 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
            Fale com nosso suporte
          </a>
          <p className="text-xs text-gray-300 pt-2">Garantia de 3 meses em todos os servicos</p>
        </div>
      </div>
    </div>
  )
}
