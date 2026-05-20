'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Check, X, Camera, Plus, Trash2 } from 'lucide-react'
import SignatureCanvas from '../../../components/signature-canvas'
import CameraCapture from '../../../components/camera-capture'
import { enqueueSubmission } from '../../../lib/offline-queue'

type PaymentMethod = 'pix' | 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'boleto'

// Split payment 2026-05-20: cliente paga em formas diferentes
// (ex: 500 PIX + 200 cartao 2x). Cada split vira receivable independente.
interface Split {
  method: PaymentMethod | ''
  amount_str: string // valor em reais "500.00"
  installments: number // so para cartao_credito
}
const emptySplit = (): Split => ({ method: '', amount_str: '', installments: 1 })

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string; icon: string; needsReceipt: boolean }[] = [
  { value: 'pix',              label: 'PIX',              icon: '⚡', needsReceipt: true  },
  { value: 'dinheiro',         label: 'Dinheiro',         icon: '💵', needsReceipt: false },
  { value: 'cartao_credito',   label: 'Cartão Crédito',   icon: '💳', needsReceipt: true  },
  { value: 'cartao_debito',    label: 'Cartão Débito',    icon: '💳', needsReceipt: true  },
  { value: 'boleto',           label: 'Boleto',           icon: '📄', needsReceipt: false },
]

function fmtBRL(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}
function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

type StopData = {
  id: string
  customer_name: string
  address: string
  os: { id: string; number: number; equipment: string; diagnosis: string | null; total_cost_cents: number } | null
}

export default function EntregaPage() {
  const router = useRouter()
  const { stopId } = useParams<{ stopId: string }>()

  const [stop, setStop] = useState<StopData | null>(null)
  const [loading, setLoading] = useState(true)

  const [outcome, setOutcome] = useState<'entregue_aprovado' | 'recusado_sem_conserto' | null>(null)
  const [refusalReason, setRefusalReason] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [paymentNotes, setPaymentNotes] = useState('')
  // Parcelas — so aparece quando cartao_credito. Cliente escolhe 1-12x.
  const [installments, setInstallments] = useState<number>(1)
  // Split payment 2026-05-20: cliente paga em formas diferentes
  const [useSplit, setUseSplit] = useState(false)
  const [splits, setSplits] = useState<Split[]>([emptySplit(), emptySplit()])
  // Dias ate vencimento do boleto — so aparece quando payment=boleto. Default 7, editavel 1-60.
  const [boletoDueDays, setBoletoDueDays] = useState<number>(7)
  const [receiptPhoto, setReceiptPhoto] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [signaturePng, setSignaturePng] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // UX-2 #4: countdown undo após confirmar entrega — 5s pra desfazer
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null)
  const [undoCountdown, setUndoCountdown] = useState<number>(0)
  // UX-4 #9: foto "delivered to" obrigatória (Amazon Flex pattern — disputa)
  const [deliveredPhoto, setDeliveredPhoto] = useState<string | null>(null)
  const [deliveredPhotoCameraOpen, setDeliveredPhotoCameraOpen] = useState(false)

  useEffect(() => {
    fetch('/api/driver/rota/hoje', { cache: 'no-store' })
      .then(r => r.json())
      .then(({ data }) => {
        const found = (data.stops || []).find((s: any) => s.id === stopId)
        if (!found) { toast.error('Parada nao encontrada'); router.back(); return }
        if (found.type !== 'ENTREGA') { toast.error('Essa parada nao e entrega'); router.back(); return }
        setStop(found)
      })
      .catch(() => toast.error('Falha ao carregar'))
      .finally(() => setLoading(false))
  }, [stopId, router])

  const amountCents = stop?.os?.total_cost_cents ?? 0
  const selectedPayment = PAYMENT_OPTIONS.find(p => p.value === paymentMethod)
  const needsReceipt = selectedPayment?.needsReceipt && amountCents > 0

  // Split helpers
  function updateSplit(idx: number, field: keyof Split, value: string | number) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }
  function addSplit() { setSplits(prev => [...prev, emptySplit()]) }
  function removeSplit(idx: number) { setSplits(prev => prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev) }

  const splitsSumCents = splits.reduce((s, sp) => s + Math.round((Number(sp.amount_str.replace(',', '.')) || 0) * 100), 0)
  const splitsValid = splitsSumCents === amountCents && splits.every(s => s.method && Number(s.amount_str.replace(',', '.')) > 0)
  // Split precisa comprovante se algum split tem PIX/cartao
  const splitNeedsReceipt = useSplit && splits.some(s => s.method && PAYMENT_OPTIONS.find(p => p.value === s.method)?.needsReceipt)

  async function getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
    return new Promise(resolve => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        // UX-11 #5: timeout 2s pra não bloquear submit em garagem subterrânea
        { enableHighAccuracy: false, timeout: 2000, maximumAge: 60_000 }
      )
    })
  }

  async function finalizar() {
    if (!outcome) return toast.error('Informe o status da entrega')
    if (outcome === 'recusado_sem_conserto' && !refusalReason.trim())
      return toast.error('Informe o motivo da recusa')
    if (outcome === 'entregue_aprovado') {
      if (useSplit) {
        if (!splitsValid) return toast.error(`Verifique formas: soma R$ ${(splitsSumCents/100).toFixed(2)} (deve ser R$ ${(amountCents/100).toFixed(2)}) e cada forma com valor`)
        if (splitNeedsReceipt && !receiptPhoto) return toast.error('Tire foto do comprovante (uma das formas precisa)')
      } else {
        if (!paymentMethod) return toast.error('Selecione a forma de pagamento')
        if (needsReceipt && !receiptPhoto) return toast.error('Tire foto do comprovante')
      }
      // UX-4 #9: foto da entrega física obrigatória (proteção em disputas)
      if (!deliveredPhoto) return toast.error('Tire foto do equipamento entregue (porta, recepção, etc)')
    }
    if (!signaturePng) return toast.error('Cliente precisa assinar')
    if (!signerName.trim()) return toast.error('Informe quem assinou')

    setSubmitting(true)
    try {
      const location = await getCurrentLocation()
      const payload: Record<string, unknown> = {
        event_id: uuidv4(),
        status: outcome,
        refusal_reason: outcome === 'recusado_sem_conserto' ? refusalReason.trim() : null,
        signature_png_base64: signaturePng.replace(/^data:image\/png;base64,/, ''),
        signer_name: signerName.trim(),
        location,
      }
      if (outcome === 'entregue_aprovado') {
        if (useSplit) {
          // Modo split: usa metodo do primeiro split como label "principal"
          // (Payment record + LogisticsStop tem 1 method field). Cada split
          // vira receivable independente via lib createReceivableOrSplit.
          payload.payment = {
            method: splits[0].method || 'pix',
            amount_cents: amountCents,
            installments: 1,
            due_days: null,
            receipt_photo_base64: receiptPhoto,
            notes: paymentNotes.trim() || `Split em ${splits.length} formas`,
            splits: splits.map(s => ({
              method: s.method as PaymentMethod,
              amount_cents: Math.round(Number(s.amount_str.replace(',', '.')) * 100),
              installments: s.method === 'cartao_credito' ? s.installments : 1,
            })),
          }
        } else {
          payload.payment = {
            method: paymentMethod,
            amount_cents: amountCents,
            installments: paymentMethod === 'cartao_credito' ? installments : 1,
            due_days: paymentMethod === 'boleto' ? boletoDueDays : null,
            receipt_photo_base64: receiptPhoto,
            notes: paymentNotes.trim() || null,
          }
        }
        // UX-4 #9: foto da entrega física no payload
        payload.delivered_photo_base64 = deliveredPhoto
      }
      // UX-2 #4: agenda undo countdown 5s antes de enfileirar de fato
      setPendingPayload(payload)
      setUndoCountdown(5)
    } catch {
      toast.error('Erro ao salvar. Tente novamente.')
    } finally { setSubmitting(false) }
  }

  // UX-2 #4: countdown undo — chega em 0, dispara enqueue + redireciona
  useEffect(() => {
    if (!pendingPayload || undoCountdown <= 0) return
    const t = setTimeout(() => setUndoCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [pendingPayload, undoCountdown])

  useEffect(() => {
    if (!pendingPayload || undoCountdown !== 0) return
    let cancelled = false
    ;(async () => {
      try {
        await enqueueSubmission(`/api/driver/stop/${stopId}/entrega`, pendingPayload)
        if (cancelled) return
        toast.success(outcome === 'entregue_aprovado' ? 'Entrega registrada! Sincronizando…' : 'Recusa registrada')
        router.replace('/motorista/rota')
      } catch {
        if (!cancelled) {
          toast.error('Erro ao salvar. Tente novamente.')
          setPendingPayload(null)
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoCountdown, pendingPayload])

  function undoSubmit() {
    setPendingPayload(null)
    setUndoCountdown(0)
    toast('Entrega não registrada — confira os dados', { icon: '↩️' })
  }

  // UX-11 #6: beforeunload guard quando há campos preenchidos
  useEffect(() => {
    const isDirty = !!(outcome || refusalReason || paymentMethod || receiptPhoto || deliveredPhoto || signaturePng || signerName)
    if (!isDirty || pendingPayload) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [outcome, refusalReason, paymentMethod, receiptPhoto, deliveredPhoto, signaturePng, signerName, pendingPayload])

  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center">
    <div className="animate-spin h-8 w-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
  </div>
  if (!stop) return null
  if (cameraOpen) return <CameraCapture
    hint="Foto do comprovante (PIX, maquininha, etc)"
    onCapture={b => { setReceiptPhoto(b); setCameraOpen(false) }}
    onCancel={() => setCameraOpen(false)} />
  if (deliveredPhotoCameraOpen) return <CameraCapture
    hint="Foto do equipamento na recepção/porta (proteção em disputas)"
    onCapture={b => { setDeliveredPhoto(b); setDeliveredPhotoCameraOpen(false) }}
    onCancel={() => setDeliveredPhotoCameraOpen(false)} />

  // UX-2 #4: tela de countdown de 5s pra desfazer
  if (pendingPayload && undoCountdown > 0) {
    const isEntrega = outcome === 'entregue_aprovado'
    return (
      <div className="min-h-[100dvh] bg-emerald-50 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-6 text-center">
          <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center ${isEntrega ? 'bg-green-500' : 'bg-red-500'} mb-4`}>
            {isEntrega ? <Check className="w-10 h-10 text-white" /> : <X className="w-10 h-10 text-white" />}
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">
            {isEntrega ? 'Entrega registrada!' : 'Recusa registrada'}
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            {isEntrega
              ? `${stop.customer_name} · ${selectedPayment?.label}${amountCents > 0 ? ` · ${fmtBRL(amountCents)}` : ''}`
              : stop.customer_name}
          </p>

          <div className="relative w-32 h-32 mx-auto mb-4">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" stroke="#d1d5db" strokeWidth="6" fill="none" />
              <circle
                cx="50" cy="50" r="45"
                stroke={isEntrega ? '#10b981' : '#ef4444'}
                strokeWidth="6" fill="none"
                strokeDasharray={`${(undoCountdown / 5) * 282.74} 282.74`}
                className="transition-all duration-1000 ease-linear"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-4xl font-bold text-gray-900">{undoCountdown}</span>
            </div>
          </div>

          <p className="text-xs text-gray-500 mb-4">
            Sincronizando em {undoCountdown}s. Toque em <strong>Desfazer</strong> se algo está errado.
          </p>

          <button
            type="button"
            onClick={undoSubmit}
            className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 active:scale-[0.99] transition min-h-[44px]"
          >
            ↩️ Desfazer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col">
      <header className="sticky top-0 bg-emerald-700 text-white px-4 py-3 flex items-center gap-3 shadow z-10">
        <button onClick={() => router.back()} aria-label="Voltar" className="p-1"><ArrowLeft className="w-6 h-6" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold leading-tight truncate">Entrega — {stop.customer_name}</h1>
          <p className="text-xs opacity-80 truncate">{stop.os ? `OS #${stop.os.number}` : ''} {stop.os?.equipment}</p>
        </div>
      </header>

      <main className="p-4 space-y-4 pb-4 flex-1">
        {/* Resumo OS */}
        <section className="bg-white rounded-xl border p-4 space-y-3">
          {stop.os?.diagnosis && (
            <div>
              <p className="text-xs uppercase font-semibold text-gray-500 mb-1">Serviço realizado</p>
              <p className="text-sm text-gray-900">{stop.os.diagnosis}</p>
            </div>
          )}
          {amountCents > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
              <p className="text-xs uppercase font-semibold text-emerald-700">Valor a receber</p>
              <p className="text-3xl font-extrabold text-emerald-700 mt-1">{fmtBRL(amountCents)}</p>
            </div>
          )}
        </section>

        {/* Status */}
        <section>
          <h2 className="font-semibold text-gray-900 mb-2">Status da entrega</h2>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setOutcome('entregue_aprovado')}
              className={`py-4 rounded-xl border-2 font-bold flex items-center justify-center gap-1.5 transition active:scale-95 ${
                outcome === 'entregue_aprovado'
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-green-700 border-gray-300'
              }`}>
              <Check className="w-5 h-5" /> Entregue
            </button>
            <button onClick={() => setOutcome('recusado_sem_conserto')}
              className={`py-4 rounded-xl border-2 font-bold flex items-center justify-center gap-1.5 transition active:scale-95 ${
                outcome === 'recusado_sem_conserto'
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white text-red-700 border-gray-300'
              }`}>
              <X className="w-5 h-5" /> Recusado
            </button>
          </div>
        </section>

        {/* Motivo recusa */}
        {outcome === 'recusado_sem_conserto' && (
          <section>
            <h2 className="font-semibold text-gray-900 mb-2">Motivo da recusa</h2>
            <textarea value={refusalReason} onChange={e => setRefusalReason(e.target.value)}
              rows={3} placeholder="Ex: cliente achou caro e optou por devolver"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white" />
          </section>
        )}

        {/* Pagamento */}
        {outcome === 'entregue_aprovado' && (
          <>
            {/* Toggle split: cliente paga em formas diferentes */}
            <section>
              <label className="flex items-center gap-2 cursor-pointer bg-amber-50 border-2 border-amber-200 rounded-lg p-3">
                <input
                  type="checkbox"
                  checked={useSplit}
                  onChange={e => setUseSplit(e.target.checked)}
                  className="w-5 h-5 cursor-pointer"
                />
                <span className="font-medium text-amber-900">💰 Cliente paga em formas diferentes</span>
              </label>
            </section>

            {/* Modo SPLIT — array de formas */}
            {useSplit && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold text-gray-900">Formas de pagamento</h2>
                  <button
                    type="button"
                    onClick={addSplit}
                    className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" /> Adicionar
                  </button>
                </div>
                <div className="space-y-3">
                  {splits.map((sp, idx) => (
                    <div key={idx} className="border-2 border-gray-200 rounded-lg p-3 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700">Forma {idx + 1}</span>
                        {splits.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeSplit(idx)}
                            className="text-red-500 cursor-pointer"
                            aria-label={`Remover forma ${idx + 1}`}
                            title={`Remover forma ${idx + 1}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <select
                        aria-label={`Metodo forma ${idx + 1}`}
                        value={sp.method}
                        onChange={e => updateSplit(idx, 'method', e.target.value)}
                        className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 bg-white text-sm"
                      >
                        <option value="">Selecione...</option>
                        {PAYMENT_OPTIONS.map(p => (
                          <option key={p.value} value={p.value}>{p.icon} {p.label}</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">R$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          value={sp.amount_str}
                          onChange={e => updateSplit(idx, 'amount_str', e.target.value)}
                          placeholder="0,00"
                          aria-label={`Valor forma ${idx + 1}`}
                          className="flex-1 border-2 border-gray-300 rounded-lg px-3 py-2 text-base font-semibold"
                        />
                      </div>
                      {sp.method === 'cartao_credito' && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">Parcelas:</span>
                          <select
                            aria-label={`Parcelas forma ${idx + 1}`}
                            value={sp.installments}
                            onChange={e => updateSplit(idx, 'installments', Number(e.target.value))}
                            className="border-2 border-gray-300 rounded-lg px-2 py-1.5 bg-white text-sm"
                          >
                            {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                              <option key={n} value={n}>{n}x</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* Validador soma */}
                <div className={`mt-3 rounded-lg border-2 p-2.5 text-sm flex items-center justify-between ${splitsValid ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-red-50 border-red-300 text-red-800'}`}>
                  <span>Soma:</span>
                  <span className="font-bold">
                    {fmtBRL(splitsSumCents)} / {fmtBRL(amountCents)}
                    {splitsValid && ' ✓'}
                  </span>
                </div>
              </section>
            )}

            {/* Modo UNICO — botoes de forma */}
            {!useSplit && (
              <section>
                <h2 className="font-semibold text-gray-900 mb-2">Forma de pagamento</h2>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_OPTIONS.map(p => (
                    <button key={p.value} onClick={() => setPaymentMethod(p.value)}
                      className={`py-3 px-4 rounded-lg border-2 text-left transition ${
                        paymentMethod === p.value
                          ? 'border-emerald-600 bg-emerald-50'
                          : 'border-gray-300 bg-white'
                      }`}>
                      <span className="text-lg">{p.icon}</span>
                      <span className="ml-2 font-medium">{p.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Vencimento do boleto — so pra boleto. Default 7 dias, editavel 1-60. */}
            {paymentMethod === 'boleto' && amountCents > 0 && (
              <section>
                <h2 className="font-semibold text-gray-900 mb-2">Vencimento do boleto</h2>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setBoletoDueDays(d => Math.max(1, d - 1))}
                    className="w-12 h-12 rounded-lg border-2 border-gray-300 text-xl font-bold text-gray-700 active:scale-95">-</button>
                  <input
                    type="number"
                    value={boletoDueDays}
                    onChange={e => {
                      const v = parseInt(e.target.value || '0', 10)
                      if (Number.isFinite(v)) setBoletoDueDays(Math.max(1, Math.min(60, v)))
                    }}
                    className="flex-1 h-12 text-center text-2xl font-bold border-2 border-emerald-500 rounded-lg"
                    min={1} max={60}
                    inputMode="numeric"
                    aria-label="Dias ate vencimento do boleto"
                    title="Dias ate vencimento do boleto"
                    placeholder="7"
                  />
                  <button type="button" onClick={() => setBoletoDueDays(d => Math.min(60, d + 1))}
                    className="w-12 h-12 rounded-lg border-2 border-gray-300 text-xl font-bold text-gray-700 active:scale-95">+</button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Cliente pagara o boleto em <strong>{boletoDueDays} dia{boletoDueDays === 1 ? '' : 's'}</strong>.
                  O boleto sera enviado pelo escritorio depois da entrega.
                </p>
              </section>
            )}

            {/* Parcelas — so pra cartao de credito. Cliente escolhe 1x-12x. */}
            {paymentMethod === 'cartao_credito' && amountCents > 0 && (
              <section>
                <h2 className="font-semibold text-gray-900 mb-2">Parcelas</h2>
                <div className="grid grid-cols-4 gap-2">
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                    <button key={n} type="button" onClick={() => setInstallments(n)}
                      className={`py-2 rounded-lg border-2 text-sm font-semibold transition ${
                        installments === n
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                          : 'border-gray-300 bg-white text-gray-700'
                      }`}>
                      {n}x
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {installments}x de <strong>{fmtBRL(Math.round(amountCents / installments))}</strong>
                  {installments > 1 && ' (sem juros — se operadora cobrar, vem descontado no liquido)'}
                </p>
              </section>
            )}

            {(needsReceipt || splitNeedsReceipt) && (
              <section>
                <h2 className="font-semibold text-gray-900 mb-2">Comprovante</h2>
                {receiptPhoto ? (
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`data:image/jpeg;base64,${receiptPhoto}`} alt="Comprovante"
                      className="w-full max-h-72 object-contain rounded-lg border" />
                    <button onClick={() => setCameraOpen(true)}
                      className="w-full py-2 border border-gray-300 rounded-lg text-gray-600">
                      Refazer foto
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setCameraOpen(true)}
                    className="w-full py-6 border-2 border-dashed border-emerald-500 rounded-xl flex flex-col items-center gap-2 active:bg-emerald-50">
                    <Camera className="w-8 h-8 text-emerald-600" />
                    <span className="font-medium text-emerald-700">Tirar foto do comprovante</span>
                  </button>
                )}
              </section>
            )}

            {/* UX-4 #9: foto delivered-to (Amazon Flex pattern) — protege em disputas */}
            <section>
              <h2 className="font-semibold text-gray-900 mb-1">Foto da entrega <span className="text-xs font-normal text-red-600">obrigatória</span></h2>
              <p className="text-xs text-gray-500 mb-2">Equipamento na porta, recepção, ou nas mãos de quem recebeu.</p>
              {deliveredPhoto ? (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/jpeg;base64,${deliveredPhoto}`} alt="Foto da entrega"
                    className="w-full max-h-72 object-contain rounded-lg border" />
                  <button type="button" onClick={() => setDeliveredPhotoCameraOpen(true)}
                    className="w-full py-2 border border-gray-300 rounded-lg text-gray-600 min-h-[44px]">
                    Refazer foto
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setDeliveredPhotoCameraOpen(true)}
                  className="w-full py-6 border-2 border-dashed border-blue-500 rounded-xl flex flex-col items-center gap-2 active:bg-blue-50 min-h-[44px]">
                  <Camera className="w-8 h-8 text-blue-600" />
                  <span className="font-medium text-blue-700">Tirar foto do equipamento entregue</span>
                </button>
              )}
            </section>

            <section>
              <h2 className="font-semibold text-gray-900 mb-2">Observação do pagamento <span className="text-xs font-normal text-gray-500">(opcional)</span></h2>
              <input value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)}
                placeholder="Ex: PIX pelo celular do cliente"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white" />
            </section>
          </>
        )}

        {/* Assinatura */}
        {outcome && (
          <section>
            <h2 className="font-semibold text-gray-900 mb-2">Assinatura</h2>
            <input value={signerName} onChange={e => setSignerName(e.target.value)}
              placeholder="Nome de quem recebeu"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white mb-2" />
            <SignatureCanvas onChange={setSignaturePng} />
          </section>
        )}
      </main>

      {outcome && (
        <div className="sticky bottom-0 left-0 right-0 p-4 bg-white border-t shadow-lg pb-[calc(1rem+env(safe-area-inset-bottom))] z-20">
          <button onClick={finalizar} disabled={submitting}
            className={`w-full font-bold py-4 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition text-white ${
              outcome === 'entregue_aprovado' ? 'bg-green-600' : 'bg-red-600'
            }`}>
            {submitting ? (
              <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
            ) : outcome === 'entregue_aprovado' ? (
              <><Check className="w-5 h-5" /> Confirmar Entrega</>
            ) : (
              <><X className="w-5 h-5" /> Registrar Recusa</>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
