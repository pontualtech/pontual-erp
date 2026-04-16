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
  is_recalculado?: boolean
  original_cost?: number | null
  discount_percent?: number | null
  max_installments?: number
  company: { name: string; phone: string | null; email: string | null; whatsapp: string | null }
}

function fmt(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function PortalOrcamentoPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-zinc-950"><div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 dark:border-blue-400 border-t-transparent" /></div>}>
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
  const [rejectReasonOption, setRejectReasonOption] = useState('')
  const [rejectConfirmed, setRejectConfirmed] = useState(false)
  const [rejectReasons, setRejectReasons] = useState<string[]>([
    'O valor nao compensa o conserto',
    'Estou sem recursos no momento',
    'Vou comprar um equipamento novo',
    'Encontrei um servico mais barato',
    'Desisti do reparo',
    'O equipamento nao e mais necessario',
    'Vou tentar resolver por conta propria',
    'Outros motivos',
  ])
  const [paymentMethod, setPaymentMethod] = useState('')
  const [showApproveForm, setShowApproveForm] = useState(false)
  const [applyDiscount, setApplyDiscount] = useState(false)
  const [clientIp, setClientIp] = useState('')

  const DISCOUNT_PERCENT = 10

  useEffect(() => {
    if (!token) { setError('Link invalido. Token de acesso nao encontrado.'); setLoading(false); return }
    fetch(`/api/portal/orcamento/${id}?token=${token}&slug=${slug}`)
      .then(r => { if (!r.ok) throw new Error('Link invalido ou expirado'); return r.json() })
      .then(res => { if (res.data) setData(res.data); else throw new Error('Dados nao encontrados') })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id, token, slug])

  // Load customizable reject reasons from DB (if configured)
  useEffect(() => {
    if (!token || !slug) return
    fetch(`/api/portal/orcamento/reject-reasons?slug=${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data?.length > 0) setRejectReasons(d.data) })
      .catch(() => {})
  }, [token, slug])

  useEffect(() => {
    fetch('https://api.ipify.org?format=json')
      .then(r => r.json())
      .then(d => setClientIp(d.ip || ''))
      .catch(() => setClientIp('N/A'))
  }, [])

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
      // GA4 tracking
      try {
        const { portalEvents } = await import('@/lib/analytics')
        if (action === 'approve') portalEvents.approveQuote(data?.os_number || 0, data?.total_cost || 0, paymentMethod)
        else portalEvents.rejectQuote(data?.os_number || 0)
        if (applyDiscount) portalEvents.acceptDiscount(data?.os_number || 0, DISCOUNT_PERCENT)
      } catch {}
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao processar')
    } finally { setSubmitting(false) }
  }

  const whatsappUrl = data?.company?.whatsapp ? `https://wa.me/${data.company.whatsapp.replace(/\D/g, '')}` : 'https://wa.me/551126263841'

  // Loading
  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 dark:from-zinc-950 dark:to-zinc-900">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-3 border-blue-600 dark:border-blue-400 border-t-transparent" />
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Carregando orcamento...</p>
      </div>
    </div>
  )

  // Error
  if (error || !data) return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 dark:from-zinc-950 dark:to-zinc-900 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-8 text-center shadow-lg dark:shadow-zinc-900/50">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
          <span className="text-2xl">⚠️</span>
        </div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Link invalido</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{error || 'Nao foi possivel carregar o orcamento.'}</p>
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-green-600 dark:bg-green-500 px-6 py-3 text-sm font-semibold text-white hover:bg-green-700">
          Falar com Suporte
        </a>
      </div>
    </div>
  )

  // Result
  if (result) {
    const isApproved = result.action === 'approved'

    if (isApproved) {
      const approvedValue = applyDiscount ? Math.round(data.total_cost * (1 - DISCOUNT_PERCENT / 100)) : data.total_cost
      const confirmationCode = btoa(`${id}-${Date.now()}`).slice(0, 8).toUpperCase()
      const approvalDateTime = new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'medium' })

      return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 dark:from-zinc-950 dark:to-zinc-900 p-4">
          <div className="w-full max-w-lg">
            {/* Receipt Card */}
            <div className="rounded-2xl border-2 border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg dark:shadow-zinc-900/50 overflow-hidden print:shadow-none print:border print:rounded-none">
              {/* Receipt Header */}
              <div className="bg-gray-900 dark:bg-zinc-800 p-6 text-center text-white print:bg-white print:text-black print:border-b-2 print:border-black">
                <h2 className="text-lg font-bold tracking-wide capitalize">Comprovante de Aprovacao</h2>
                <p className="mt-1 text-gray-400 dark:text-gray-500 text-xs print:text-gray-600">{data.company.name}</p>
              </div>

              {/* Receipt Body */}
              <div className="p-6 space-y-4">
                {/* Status Badge */}
                <div className="text-center">
                  <span className="inline-block rounded-full bg-green-100 dark:bg-green-950 border border-green-300 dark:border-green-900 px-4 py-1.5 text-sm font-bold text-green-700 dark:text-green-400">
                    APROVADO
                  </span>
                </div>

                {/* Details Table */}
                <div className="border border-gray-200 dark:border-zinc-700 rounded-lg divide-y divide-gray-200 dark:divide-zinc-700 text-sm">
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-gray-500 dark:text-gray-400">Ordem de Servico</span>
                    <span className="font-bold text-gray-900 dark:text-gray-100 font-mono">#{data.os_number}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-gray-500 dark:text-gray-400">Cliente</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{data.customer_name}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-gray-500 dark:text-gray-400">Equipamento</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{[data.equipment_type, data.equipment_brand, data.equipment_model].filter(Boolean).join(' ')}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3 bg-green-50 dark:bg-green-950">
                    <span className="text-gray-500 dark:text-gray-400">Valor Aprovado</span>
                    <div className="text-right">
                      {applyDiscount && (
                        <span className="block text-xs text-gray-400 dark:text-gray-500 line-through">{fmt(data.total_cost)}</span>
                      )}
                      <span className="font-bold text-green-700 dark:text-green-400 text-lg">{fmt(approvedValue)}</span>
                      {applyDiscount && (
                        <span className="block text-xs text-green-600 dark:text-green-400 font-semibold">({DISCOUNT_PERCENT}% desconto)</span>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-gray-500 dark:text-gray-400">Forma de Pagamento</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{paymentMethod}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-gray-500 dark:text-gray-400">Data/Hora</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100 text-right text-xs">{approvalDateTime}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-gray-500 dark:text-gray-400">IP</span>
                    <span className="font-mono text-gray-700 dark:text-gray-300 text-xs">{clientIp || '...'}</span>
                  </div>
                </div>

                {/* Confirmation Code */}
                <div className="rounded-lg bg-gray-100 dark:bg-zinc-800 border border-dashed border-gray-400 dark:border-zinc-600 p-4 text-center">
                  <p className="text-xs text-gray-500 dark:text-gray-400 capitalize tracking-wide mb-1">Codigo de Confirmacao</p>
                  <p className="text-2xl font-bold font-mono tracking-widest text-gray-900 dark:text-gray-100">{confirmationCode}</p>
                </div>

                {/* Next Steps */}
                <div className="rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 p-4 text-sm text-blue-800 dark:text-blue-300 print:hidden">
                  <p className="font-semibold mb-1">Proximo passo</p>
                  <p>Nossa equipe tecnica ja foi notificada e o reparo comeca agora. Voce recebera um aviso quando estiver pronto.</p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 print:hidden">
                  <button type="button" onClick={() => window.print()}
                    className="flex-1 rounded-lg bg-gray-900 dark:bg-zinc-700 py-3 text-center text-sm font-semibold text-white hover:bg-gray-800 dark:hover:bg-zinc-600">
                    Imprimir Comprovante
                  </button>
                  <button type="button" onClick={() => window.location.href = whatsappUrl}
                    className="flex-1 rounded-lg bg-green-600 dark:bg-green-500 py-3 text-center text-sm font-semibold text-white hover:bg-green-700">
                    Voltar ao Portal
                  </button>
                </div>
              </div>

              {/* Receipt Footer */}
              <div className="border-t border-gray-200 dark:border-zinc-700 px-6 py-4 text-center space-y-1">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{data.company.name}</p>
                {data.company.phone && <p className="text-xs text-gray-400 dark:text-gray-500">Tel: {data.company.phone}</p>}
                {data.company.email && <p className="text-xs text-gray-400 dark:text-gray-500">{data.company.email}</p>}
              </div>
            </div>
          </div>
        </div>
      )
    }

    // Rejected result — friendly message with support link
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 dark:from-zinc-950 dark:to-zinc-900 p-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg dark:shadow-zinc-900/50 overflow-hidden">
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950">
              <span className="text-3xl">📋</span>
            </div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">Decisao registrada</h2>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              Registramos sua decisao sobre a OS <strong>#{data.os_number}</strong>.
              Seu equipamento ficara disponivel para retirada na nossa loja.
            </p>
          </div>

          <div className="px-6 pb-6 space-y-4">
            <div className="rounded-xl bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950 border border-green-200 dark:border-green-900 p-5 text-center">
              <p className="text-sm font-semibold text-green-800 dark:text-green-300 mb-2">Mudou de ideia? Quer negociar?</p>
              <p className="text-xs text-green-700 dark:text-green-400 mb-4">Fale com nossa equipe — podemos encontrar a melhor solucao juntos!</p>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-green-600 dark:bg-green-500 px-8 py-3.5 text-sm font-bold text-white shadow-lg hover:bg-green-700 transition-all hover:scale-105">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.611.611l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.387 0-4.594-.838-6.32-2.234l-.144-.113-3.147 1.055 1.055-3.147-.113-.144A9.935 9.935 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                </svg>
                Falar com Suporte
              </a>
            </div>

            {data.company.phone && (
              <p className="text-center text-xs text-gray-400 dark:text-gray-500">
                Ou ligue: <strong>{data.company.phone}</strong>
              </p>
            )}
          </div>

          <div className="border-t border-gray-200 dark:border-zinc-700 px-6 py-4 text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">{data.company.name}</p>
          </div>
        </div>
      </div>
    )
  }

  const equipment = [data.equipment_type, data.equipment_brand, data.equipment_model].filter(Boolean).join(' ')
  const services = data.items.filter(i => i.item_type === 'SERVICO')
  const parts = data.items.filter(i => i.item_type !== 'SERVICO')
  const isRecalculado = data.is_recalculado || false
  const originalCost = data.original_cost || 0
  const discountPct = data.discount_percent || 0
  const maxInstallments = data.max_installments || 3
  const installmentValue = fmt(Math.ceil(data.total_cost / maxInstallments))

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-zinc-950 dark:to-zinc-900 p-4 pb-8">
      <div className="mx-auto max-w-2xl">

        {/* Header */}
        <div className="mb-6 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-lg dark:shadow-zinc-900/50 overflow-hidden">
          <div className={`p-6 text-center text-white ${isRecalculado ? 'bg-gradient-to-r from-amber-500 to-orange-600' : 'bg-gradient-to-r from-blue-600 to-blue-700'}`}>
            {isRecalculado && (
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur-sm px-4 py-1.5 text-xs font-bold uppercase tracking-wider">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                Nova Proposta Especial
              </div>
            )}
            <h1 className="text-xl font-bold">{data.company.name}</h1>
            <p className="mt-1 text-sm opacity-80">{isRecalculado ? 'Preparamos uma condicao diferenciada para voce' : 'Orcamento Tecnico'}</p>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Ordem de Servico</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">#{data.os_number}</p>
                  {data.quote_version && (
                    <span className="rounded-full bg-indigo-100 dark:bg-indigo-950 border border-indigo-300 dark:border-indigo-800 px-2.5 py-0.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                      v{data.quote_version}
                    </span>
                  )}
                </div>
              </div>
              <span className="rounded-full bg-amber-100 dark:bg-amber-950 border border-amber-300 dark:border-amber-900 px-3 py-1 text-xs font-bold text-amber-800 dark:text-amber-300">
                {data.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-400 dark:text-gray-500 text-xs capitalize">Cliente</p>
                <p className="font-medium text-gray-900 dark:text-gray-100">{data.customer_name}</p>
              </div>
              <div>
                <p className="text-gray-400 dark:text-gray-500 text-xs capitalize">Equipamento</p>
                <p className="font-medium text-gray-900 dark:text-gray-100">{equipment}</p>
              </div>
              {data.serial_number && (
                <div>
                  <p className="text-gray-400 dark:text-gray-500 text-xs capitalize">N Serie</p>
                  <p className="font-mono text-gray-900 dark:text-gray-100">{data.serial_number}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Laudo */}
        <div className="mb-4 rounded-2xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 shadow-sm dark:shadow-zinc-900/50">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 capitalize tracking-wide mb-3">Laudo Tecnico</h3>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-gray-400 dark:text-gray-500 text-xs capitalize mb-1">Problema relatado</p>
              <p className="text-gray-900 dark:text-gray-100">{data.reported_issue}</p>
            </div>
            {data.diagnosis && (
              <div className="border-t border-gray-200 dark:border-zinc-700 pt-3">
                <p className="text-gray-400 dark:text-gray-500 text-xs capitalize mb-1">Laudo</p>
                <p className="text-gray-900 dark:text-gray-100">{data.diagnosis}</p>
              </div>
            )}
          </div>
        </div>

        {/* Items */}
        {data.items.length > 0 && (
          <div className="mb-4 rounded-2xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-zinc-900/50 overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-zinc-700">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 capitalize tracking-wide">Detalhamento</h3>
            </div>

            {services.length > 0 && (
              <>
                <div className="bg-blue-50 dark:bg-blue-950 px-4 py-2 text-xs font-bold capitalize text-blue-700 dark:text-blue-300 border-b border-gray-200 dark:border-zinc-700">
                  Servicos
                </div>
                <div className="divide-y divide-gray-200 dark:divide-zinc-700">
                  {services.map(item => (
                    <div key={item.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.description}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{item.quantity}x {fmt(item.unit_price)}</p>
                      </div>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmt(item.total_price)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {parts.length > 0 && (
              <>
                <div className="bg-purple-50 dark:bg-purple-950 px-4 py-2 text-xs font-bold capitalize text-purple-700 dark:text-purple-300 border-b border-t border-gray-200 dark:border-zinc-700">
                  Pecas e Componentes
                </div>
                <div className="divide-y divide-gray-200 dark:divide-zinc-700">
                  {parts.map(item => (
                    <div key={item.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.description}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{item.quantity}x {fmt(item.unit_price)}</p>
                      </div>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmt(item.total_price)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Discount comparison card (recalculated only) */}
        {isRecalculado && originalCost > 0 && (
          <div className="mb-4 rounded-2xl bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border-2 border-green-300 dark:border-green-800 p-6 text-center shadow-lg">
            <p className="text-xs font-bold uppercase tracking-wider text-green-700 dark:text-green-400 mb-3">Desconto Especial para Voce</p>
            <div className="flex items-center justify-center gap-3 mb-3">
              <span className="text-xl text-gray-400 line-through">{fmt(originalCost)}</span>
              <svg className="h-5 w-5 text-green-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
              <span className="text-3xl font-extrabold text-green-700 dark:text-green-300">{fmt(data.total_cost)}</span>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-4 py-1.5 text-sm font-bold text-white">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
              {discountPct}% OFF — Voce economiza {fmt(originalCost - data.total_cost)}
            </span>
          </div>
        )}

        {/* Total + Parcelas + Garantia */}
        <div className="mb-4 rounded-2xl overflow-hidden shadow-lg dark:shadow-zinc-900/50">
          <div className={`p-6 text-center text-white ${isRecalculado ? 'bg-gradient-to-r from-amber-500 to-orange-600' : 'bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-700 dark:to-blue-800'}`}>
            <p className="text-3xl font-extrabold">{maxInstallments}x de {installmentValue}</p>
            <p className="mt-1 text-sm opacity-80">sem juros no cartao de credito</p>
            <p className="mt-2 text-xs opacity-60">Valor total: {fmt(data.total_cost)}</p>
          </div>
          <div className="bg-gradient-to-r from-green-600 to-emerald-600 dark:from-green-700 dark:to-emerald-700 px-6 py-3 flex items-center justify-center gap-3 text-white">
            <svg className="h-5 w-5 text-green-200" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
            <div className="text-center">
              <p className="text-sm font-bold">3 meses de garantia</p>
              <p className="text-xs text-green-200">em todos os servicos e pecas</p>
            </div>
          </div>
        </div>

        {/* Counter-Offer */}
        {showCounterOffer && data && (() => {
          const discountedPrice = Math.round(data.total_cost * (1 - DISCOUNT_PERCENT / 100))
          const discountInstallmentValue = fmt(Math.ceil(discountedPrice / maxInstallments))
          return (
            <div className="mb-4 rounded-2xl border-2 border-amber-300 dark:border-amber-700 bg-gradient-to-b from-amber-50 to-white dark:from-amber-950 dark:to-zinc-900 p-6 shadow-lg dark:shadow-zinc-900/50">
              <div className="text-center mb-5">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
                  <span className="text-2xl">💡</span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Entendemos sua preocupacao!</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Que tal um desconto especial para fechar agora?</p>
              </div>

              <div className="rounded-xl bg-white dark:bg-zinc-800 border-2 border-green-200 dark:border-green-900 p-5 mb-5 text-center shadow-sm dark:shadow-zinc-900/50">
                <p className="text-xs text-gray-400 dark:text-gray-500 capitalize tracking-wide mb-2">Oferta exclusiva</p>
                <p className="text-lg text-gray-400 dark:text-gray-500 line-through">{fmt(data.total_cost)}</p>
                <p className="text-3xl font-extrabold text-green-600 dark:text-green-400 mt-1">{fmt(discountedPrice)}</p>
                <span className="inline-block mt-2 rounded-full bg-green-100 dark:bg-green-950 border border-green-300 dark:border-green-900 px-3 py-1 text-xs font-bold text-green-700 dark:text-green-400">
                  {DISCOUNT_PERCENT}% DE DESCONTO
                </span>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">ou {maxInstallments}x de {discountInstallmentValue} sem juros</p>
              </div>

              <div className="space-y-3">
                <button type="button"
                  onClick={() => {
                    setApplyDiscount(true)
                    setShowCounterOffer(false)
                    setShowApproveForm(true)
                  }}
                  className="w-full rounded-xl bg-green-600 dark:bg-green-500 py-4 text-base font-bold text-white shadow-lg hover:bg-green-700 transition-colors">
                  Aceitar com desconto
                </button>
                <button type="button"
                  onClick={() => {
                    setShowCounterOffer(false)
                    setShowRejectForm(true)
                    setRejectReasonOption('')
                    setRejectReason('')
                  }}
                  className="w-full text-center text-xs text-gray-400 dark:text-gray-500 underline decoration-dotted underline-offset-4 py-2 hover:text-gray-600 dark:hover:text-gray-400 transition-colors">
                  Nao desejo prosseguir com o reparo
                </button>
                <button type="button"
                  onClick={() => setShowCounterOffer(false)}
                  className="w-full rounded-lg border border-gray-300 dark:border-zinc-600 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                  Voltar
                </button>
              </div>
            </div>
          )
        })()}

        {/* Reject Form — Step 1: Motivo */}
        {showRejectForm && !rejectConfirmed && (
          <div className="mb-4 rounded-2xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 shadow-sm dark:shadow-zinc-900/50">
            <div className="text-center mb-5">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Sentimos muito!</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Pode nos contar o motivo? Isso nos ajuda a melhorar.</p>
            </div>

            <div className="space-y-2 mb-4">
              {rejectReasons.map((reason, i) => (
                <button key={i} type="button"
                  onClick={() => setRejectReasonOption(reason)}
                  className={`w-full rounded-lg border p-3 text-left text-sm transition-all ${
                    rejectReasonOption === reason
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium'
                      : 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-zinc-600 hover:bg-gray-50 dark:hover:bg-zinc-800'
                  }`}>
                  <span className="flex items-center gap-2">
                    <span className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                      rejectReasonOption === reason ? 'border-blue-500' : 'border-gray-300 dark:border-zinc-600'
                    }`}>
                      {rejectReasonOption === reason && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                    </span>
                    {reason}
                  </span>
                </button>
              ))}
            </div>

            {rejectReasonOption === 'Outros motivos' && (
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                placeholder="Conte-nos o motivo..."
                className="mb-4 w-full rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 dark:text-gray-100 p-3 text-sm placeholder-gray-400 dark:placeholder-gray-600 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                rows={3} />
            )}

            <div className="flex gap-3">
              <button type="button"
                onClick={() => {
                  const finalReason = rejectReasonOption === 'Outros motivos' ? (rejectReason || 'Outros motivos') : rejectReasonOption
                  setRejectReason(finalReason)
                  handleAction('reject')
                }}
                disabled={submitting || !rejectReasonOption}
                className="flex-1 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 py-3 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors">
                {submitting ? 'Enviando...' : 'Confirmar recusa'}
              </button>
              <button type="button" onClick={() => { setShowRejectForm(false); setRejectReasonOption('') }}
                className="rounded-lg bg-green-600 dark:bg-green-500 px-6 py-3 text-sm font-semibold text-white hover:bg-green-700 transition-colors">
                Voltar ao orcamento
              </button>
            </div>
          </div>
        )}

        {/* Approve Form — selecionar pagamento */}
        {showApproveForm && !showRejectForm && data && (() => {
          const displayCost = applyDiscount ? Math.round(data.total_cost * (1 - DISCOUNT_PERCENT / 100)) : data.total_cost
          return (
          <div className="mb-4 rounded-2xl border-2 border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 p-6 shadow-sm dark:shadow-zinc-900/50">
            {applyDiscount && (
              <div className="mb-4 rounded-lg bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-700 p-3 text-center">
                <p className="text-xs text-green-700 dark:text-green-400 font-bold capitalize tracking-wide">Desconto de {DISCOUNT_PERCENT}% aplicado!</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 line-through">{fmt(data.total_cost)}</p>
                <p className="text-xl font-extrabold text-green-700 dark:text-green-400">{fmt(displayCost)}</p>
              </div>
            )}
            <h3 className="mb-2 font-bold text-green-800 dark:text-green-300">Como deseja pagar?</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">O pagamento sera realizado no momento da entrega do equipamento.</p>

            <div className="space-y-3 mb-4">
              {/* PIX */}
              <button type="button" onClick={() => setPaymentMethod('PIX')}
                className={`w-full rounded-lg border-2 p-4 text-left transition-all ${paymentMethod === 'PIX' ? 'border-green-500 bg-green-100 dark:bg-green-950' : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-green-300'}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">⚡ PIX</p><p className="text-xs text-gray-500 dark:text-gray-400">Pagamento a vista na entrega</p></div>
                  <p className="text-lg font-bold text-green-700 dark:text-green-400">{fmt(displayCost)}</p>
                </div>
              </button>

              {/* Dinheiro */}
              <button type="button" onClick={() => setPaymentMethod('Dinheiro')}
                className={`w-full rounded-lg border-2 p-4 text-left transition-all ${paymentMethod === 'Dinheiro' ? 'border-green-500 bg-green-100 dark:bg-green-950' : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-green-300'}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">💵 Dinheiro</p><p className="text-xs text-gray-500 dark:text-gray-400">Pagamento a vista na entrega</p></div>
                  <p className="text-lg font-bold text-green-700 dark:text-green-400">{fmt(displayCost)}</p>
                </div>
              </button>

              {/* Cartão Crédito com dropdown */}
              <div className={`rounded-lg border-2 p-4 transition-all ${paymentMethod.startsWith('Cartao Credito') ? 'border-green-500 bg-green-100 dark:bg-green-950' : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">💳 Cartao de Credito</p><p className="text-xs text-gray-500 dark:text-gray-400">Ate 3x sem juros na entrega</p></div>
                  <select title="Parcelas" value={paymentMethod.startsWith('Cartao Credito') ? paymentMethod : ''}
                    onChange={e => { if (e.target.value) setPaymentMethod(e.target.value) }}
                    className="rounded-md border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-100">
                    <option value="">Parcelas</option>
                    <option value="Cartao Credito 1x">1x de {fmt(displayCost)}</option>
                    <option value="Cartao Credito 2x">2x de {fmt(Math.ceil(displayCost / 2))}</option>
                    <option value="Cartao Credito 3x">3x de {fmt(Math.ceil(displayCost / 3))}</option>
                  </select>
                </div>
              </div>

              {/* Cartão Débito */}
              <button type="button" onClick={() => setPaymentMethod('Cartao Debito')}
                className={`w-full rounded-lg border-2 p-4 text-left transition-all ${paymentMethod === 'Cartao Debito' ? 'border-green-500 bg-green-100 dark:bg-green-950' : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-green-300'}`}>
                <div className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">💳 Cartao de Debito</p><p className="text-xs text-gray-500 dark:text-gray-400">Pagamento a vista na entrega</p></div>
                  <p className="text-lg font-bold text-green-700 dark:text-green-400">{fmt(displayCost)}</p>
                </div>
              </button>

              {/* Boleto — só PJ */}
              {data.customer_person_type === 'JURIDICA' && (
                <button type="button" onClick={() => setPaymentMethod('Boleto 7 dias')}
                  className={`w-full rounded-lg border-2 p-4 text-left transition-all ${paymentMethod === 'Boleto 7 dias' ? 'border-green-500 bg-green-100 dark:bg-green-950' : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-green-300'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">🏦 Boleto Bancario</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Vencimento em 7 dias — sujeito a analise de credito</p>
                    </div>
                    <p className="text-lg font-bold text-green-700 dark:text-green-400">{fmt(displayCost)}</p>
                  </div>
                </button>
              )}
            </div>

            <div className="rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 p-3 mb-4">
              <p className="text-xs text-blue-800 dark:text-blue-300 font-medium">Importante: o pagamento sera realizado no momento da entrega/retirada do equipamento.</p>
            </div>

            <div className="rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 p-4 mb-4">
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">📅 Previsao de entrega</p>
              <p className="text-xs text-blue-700 dark:text-blue-400">Ate <strong>10 dias uteis</strong> a partir da aprovacao. Sempre tentamos entregar o quanto antes!</p>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => handleAction('approve')} disabled={submitting || !paymentMethod}
                className="flex-1 rounded-lg bg-green-600 dark:bg-green-500 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
                {submitting ? 'Processando...' : '✅ Confirmar Aprovacao'}
              </button>
              <button type="button" onClick={() => { setShowApproveForm(false); setApplyDiscount(false); setPaymentMethod('') }}
                className="rounded-lg border border-gray-300 dark:border-zinc-600 px-6 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800">
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
              <div className="mb-6 rounded-2xl bg-gray-100 dark:bg-zinc-800 p-6 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">Este orcamento nao esta disponivel para aprovacao no momento.</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Status atual: {data.status}</p>
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-green-600 dark:bg-green-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700">
                  Falar com Suporte
                </a>
              </div>
            )
          }

          if (!valorValido) {
            return (
              <div className="mb-6 rounded-2xl bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 p-6 text-center">
                <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">Orcamento ainda sem valor definido.</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Aguarde a equipe tecnica finalizar o laudo e definir o valor.</p>
              </div>
            )
          }

          return (
            <div className="mb-6">
              {/* Condicoes do Orcamento */}
              <div className="mb-5 rounded-2xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm dark:shadow-zinc-900/50 overflow-hidden">
                <div className="divide-y divide-gray-100 dark:divide-zinc-800 text-sm">
                  <div className="flex items-start gap-3 px-5 py-3.5">
                    <span className="text-blue-500 mt-0.5">📅</span>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-200">Prazo de entrega</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Ate 10 dias uteis apos a aprovacao. Sempre tentamos entregar o quanto antes!</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 px-5 py-3.5">
                    <span className="text-green-500 mt-0.5">💳</span>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-200">Formas de pagamento</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">PIX, dinheiro, cartao de credito (ate 3x sem juros) ou debito. Pagamento na entrega/retirada do equipamento.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 px-5 py-3.5">
                    <span className="text-amber-500 mt-0.5">🛡️</span>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-200">Garantia</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">3 meses de garantia em todos os servicos e pecas, conforme Art. 26 do CDC.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 px-5 py-3.5">
                    <span className="text-purple-500 mt-0.5">ℹ️</span>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-200">Importante</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Este orcamento tem validade de 15 dias. Os valores podem ser alterados apos esse prazo. Em caso de duvida, fale com nosso suporte.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Aprovar — Grande, chamativo, convidativo */}
              <button type="button" onClick={() => setShowApproveForm(true)} disabled={submitting}
                className="w-full rounded-2xl bg-gradient-to-r from-green-500 to-green-600 dark:from-green-500 dark:to-green-600 py-5 text-lg font-bold text-white shadow-xl dark:shadow-green-900/30 hover:from-green-600 hover:to-green-700 disabled:opacity-50 transition-all hover:scale-[1.01] hover:shadow-2xl mb-3">
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Aprovar Orcamento
                </span>
                <span className="block text-sm font-normal text-green-100 mt-1">Autorizar o reparo e escolher forma de pagamento</span>
              </button>

              {/* Recusar — Discreto, link-style */}
              <div className="text-center mt-4">
                <button type="button" onClick={() => { setShowRejectForm(true); setRejectReasonOption(''); setRejectReason(''); setRejectConfirmed(false) }} disabled={submitting}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 underline decoration-dotted underline-offset-4 disabled:opacity-50 transition-colors">
                  Nao desejo prosseguir com o reparo
                </button>
              </div>
            </div>
          )
        })()}

        {/* WhatsApp Suporte — flutuante elegante */}
        <div className="fixed bottom-6 right-6 z-50">
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-full bg-green-500 pl-5 pr-6 py-3 text-sm font-semibold text-white shadow-2xl dark:shadow-zinc-900/50 hover:bg-green-600 transition-all hover:scale-105">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.611.611l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.387 0-4.594-.838-6.32-2.234l-.144-.113-3.147 1.055 1.055-3.147-.113-.144A9.935 9.935 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
            </svg>
            Suporte
          </a>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center space-y-2">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{data.company.name}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">Assistencia Tecnica em Informatica</p>
          {data.company.phone && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Tel: <a href={`tel:${data.company.phone}`} className="hover:text-blue-600 dark:hover:text-blue-400">{data.company.phone}</a>
            </p>
          )}
          {data.company.email && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{data.company.email}</p>
          )}
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium hover:text-green-700">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.611.611l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.387 0-4.594-.838-6.32-2.234l-.144-.113-3.147 1.055 1.055-3.147-.113-.144A9.935 9.935 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
            Fale com nosso suporte
          </a>
          <p className="text-xs text-gray-300 dark:text-gray-600 pt-2">Garantia de 3 meses em todos os servicos</p>
        </div>
      </div>
    </div>
  )
}
