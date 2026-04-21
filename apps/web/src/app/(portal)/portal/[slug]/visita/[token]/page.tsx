'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Clock, MapPin, Package, Truck, CalendarClock, Loader2 } from 'lucide-react'

type VisitData = {
  customer_name: string | null
  address: string
  type: 'COLETA' | 'ENTREGA' | string
  driver_name: string | null
  company_name: string
  eta_minutes: number | null
  notified_at: string | null
  confirmed_at: string | null
  reschedule_at: string | null
  reschedule_note: string | null
  status: string | null
  os: { number: number; equipment: string } | null
}

export default function ConfirmacaoVisitaPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<VisitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [action, setAction] = useState<'confirmed' | 'rescheduled' | null>(null)
  const [showReschedule, setShowReschedule] = useState(false)
  const [rescheduleNote, setRescheduleNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/portal/visit/${token}`, { cache: 'no-store' })
      if (!res.ok) { setInvalid(true); return }
      const { data: d } = await res.json()
      setData(d)
      if (d.confirmed_at) setAction('confirmed')
      else if (d.reschedule_at) setAction('rescheduled')
    } catch { setInvalid(true) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [token])  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConfirm() {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/portal/visit/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' }),
      })
      if (!res.ok) throw new Error()
      setAction('confirmed')
      toast.success('Presença confirmada! Aguardamos você.')
    } catch { toast.error('Erro ao confirmar. Tente novamente.') }
    finally { setSubmitting(false) }
  }

  async function handleReschedule() {
    if (!rescheduleNote.trim()) return toast.error('Conte brevemente o motivo')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/portal/visit/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reschedule', note: rescheduleNote.trim() }),
      })
      if (!res.ok) throw new Error()
      setAction('rescheduled')
      setShowReschedule(false)
      toast.success('Recebido. Nossa equipe vai entrar em contato pra remarcar.')
    } catch { toast.error('Erro ao enviar. Tente novamente.') }
    finally { setSubmitting(false) }
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    )
  }

  if (invalid || !data) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link não encontrado</h1>
          <p className="text-gray-600 text-sm">
            Este link de confirmação não é válido ou já expirou.<br />
            Entre em contato com a empresa por WhatsApp.
          </p>
        </div>
      </div>
    )
  }

  const isColeta = data.type === 'COLETA'
  const typeLabel = isColeta ? 'Coleta' : 'Entrega'
  const TypeIcon = isColeta ? Package : Truck

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-blue-50 to-indigo-100 p-4 pt-10">
      <div className="max-w-md mx-auto">
        {/* Hero */}
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className={`p-6 text-center text-white ${isColeta ? 'bg-purple-600' : 'bg-emerald-600'}`}>
            <div className="inline-flex items-center gap-2 bg-white/20 rounded-full px-3 py-1 text-xs font-semibold mb-3">
              <TypeIcon className="w-3.5 h-3.5" />
              {typeLabel}{data.os ? ` — OS #${data.os.number}` : ''}
            </div>
            {action === 'confirmed' ? (
              <>
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Check className="w-10 h-10" />
                </div>
                <h1 className="text-2xl font-bold mb-1">Presença confirmada!</h1>
                <p className="opacity-90 text-sm">Aguardamos você no local</p>
              </>
            ) : action === 'rescheduled' ? (
              <>
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CalendarClock className="w-10 h-10" />
                </div>
                <h1 className="text-2xl font-bold mb-1">Remarcação recebida</h1>
                <p className="opacity-90 text-sm">Nossa equipe vai entrar em contato</p>
              </>
            ) : (
              <>
                <Truck className="w-16 h-16 mx-auto mb-3" />
                <h1 className="text-2xl font-bold mb-1">
                  {data.driver_name ? `${data.driver_name.split(' ')[0]} está a caminho!` : 'A caminho!'}
                </h1>
                {data.eta_minutes && (
                  <p className="opacity-90 text-sm">Previsão: {data.eta_minutes} minutos</p>
                )}
              </>
            )}
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* Saudação */}
            {data.customer_name && (
              <p className="text-gray-700">
                Olá, <strong>{data.customer_name.split(' ')[0]}</strong>!
              </p>
            )}

            {/* Card com endereço */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                <p className="text-sm text-gray-700">{data.address}</p>
              </div>
              {data.os && (
                <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                  <TypeIcon className="w-4 h-4 text-gray-500 shrink-0" />
                  <p className="text-sm text-gray-700">{data.os.equipment}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            {action === null && !showReschedule && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600 text-center">
                  Você estará no local para {typeLabel.toLowerCase()}?
                </p>
                <button onClick={handleConfirm} disabled={submitting}
                  type="button"
                  className={`w-full font-bold py-4 rounded-xl flex items-center justify-center gap-2 text-white active:scale-[0.99] transition ${isColeta ? 'bg-purple-600 hover:bg-purple-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (<><Check className="w-5 h-5" /> Sim, estarei no local</>)}
                </button>
                <button onClick={() => setShowReschedule(true)} disabled={submitting}
                  type="button"
                  className="w-full border-2 border-gray-300 text-gray-700 font-semibold py-3 rounded-xl active:scale-[0.99] transition">
                  Preciso remarcar
                </button>
              </div>
            )}

            {action === null && showReschedule && (
              <div className="space-y-3">
                <p className="text-sm text-gray-700 font-medium">Qual o melhor horário pra remarcar?</p>
                <textarea value={rescheduleNote} onChange={e => setRescheduleNote(e.target.value)}
                  rows={3} placeholder="Ex: pode ser amanhã depois das 14h?"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setShowReschedule(false)} disabled={submitting}
                    type="button"
                    className="border-2 border-gray-300 text-gray-600 font-semibold py-3 rounded-xl">
                    Voltar
                  </button>
                  <button onClick={handleReschedule} disabled={submitting || !rescheduleNote.trim()}
                    type="button"
                    className="bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-1 disabled:opacity-50">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar'}
                  </button>
                </div>
              </div>
            )}

            {action === 'confirmed' && (
              <p className="text-sm text-center text-gray-600">
                Prepare o equipamento e aguarde o técnico no endereço acima.
                Dúvidas? Fale conosco no WhatsApp.
              </p>
            )}
            {action === 'rescheduled' && data.reschedule_note && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
                <p className="font-semibold mb-1">Sua solicitação:</p>
                <p>&quot;{data.reschedule_note}&quot;</p>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          {data.company_name}
        </p>
      </div>
    </div>
  )
}
