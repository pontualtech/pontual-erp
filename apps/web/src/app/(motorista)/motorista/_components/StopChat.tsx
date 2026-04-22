'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Send, Loader2, AlertCircle, User } from 'lucide-react'

/**
 * Drawer de chat motorista<->cliente para um stop especifico.
 * Usa endpoints GET/POST /api/driver/stop/[id]/messages.
 *
 * Polling 8s quando aberto. Fechado = sem polling (bateria).
 * Input desabilitado quando stop nao esta ativo (EN_ROUTE/ARRIVED).
 */

interface Message {
  id: string
  body: string
  from: 'driver' | 'customer'
  sender_name: string
  created_at: string
}

interface StopChatProps {
  stopId: string
  customerName: string
  open: boolean
  onClose: () => void
}

function fmtClock(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

export default function StopChat({ stopId, customerName, open, onClose }: StopChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [active, setActive] = useState(true)
  const [stopStatus, setStopStatus] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const lastAtRef = useRef<string | null>(null)

  const load = useCallback(async (incremental = false) => {
    try {
      setError(null)
      const qs = incremental && lastAtRef.current ? `?since=${encodeURIComponent(lastAtRef.current)}` : ''
      const res = await fetch(`/api/driver/stop/${stopId}/messages${qs}`, { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error || 'Falha ao carregar mensagens')
        return
      }
      const { data } = await res.json()
      setActive(!!data.active)
      setStopStatus(data.stop_status || '')
      if (incremental) {
        if ((data.messages || []).length > 0) {
          setMessages(prev => [...prev, ...data.messages])
          lastAtRef.current = data.messages[data.messages.length - 1].created_at
        }
      } else {
        setMessages(data.messages || [])
        if ((data.messages || []).length > 0) {
          lastAtRef.current = data.messages[data.messages.length - 1].created_at
        }
      }
    } catch {
      setError('Falha de rede')
    }
  }, [stopId])

  // Carga inicial + polling 8s enquanto aberto
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    load(false).finally(() => { if (!cancelled) setLoading(false) })
    const id = setInterval(() => { if (!cancelled) load(true) }, 8_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [open, load])

  // Auto-scroll pro final quando chega msg nova
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    }
  }, [messages.length])

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/driver/stop/${stopId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j?.error || 'Falha ao enviar')
        return
      }
      setInput('')
      // Optimistic: adiciona na lista
      if (j.data) {
        setMessages(prev => [...prev, {
          id: j.data.id,
          body: j.data.body,
          from: 'driver',
          sender_name: 'Voce',
          created_at: j.data.created_at,
        }])
        lastAtRef.current = j.data.created_at
        if (!j.data.whatsapp_sent) {
          setError('Salvo mas WhatsApp falhou: ' + (j.data.whatsapp_error || 'erro desconhecido'))
        }
      }
    } catch {
      setError('Falha de rede ao enviar')
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full max-w-lg h-[80vh] sm:h-[70vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 truncate">{customerName}</h3>
              <p className="text-xs text-gray-500">
                {active ? 'Conversa ativa' : `Encerrada (${stopStatus})`}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Fechar">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Mensagens */}
        <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 bg-gray-50 space-y-2">
          {loading && messages.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          )}
          {!loading && messages.length === 0 && (
            <div className="text-center py-12 text-sm text-gray-500">
              <p>Nenhuma mensagem ainda.</p>
              <p className="text-xs mt-1">Envie uma mensagem pro cliente abaixo.</p>
            </div>
          )}
          {messages.map(m => {
            const mine = m.from === 'driver'
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  mine
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-white text-gray-800 border border-gray-200 rounded-bl-sm'
                }`}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`text-[10px] mt-1 ${mine ? 'text-indigo-200' : 'text-gray-400'}`}>
                    {fmtClock(m.created_at)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Erro */}
        {error && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-200 flex items-center gap-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 font-medium">Ok</button>
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t border-gray-200 bg-white">
          {!active ? (
            <p className="text-xs text-center text-gray-500 py-2">
              Parada encerrada. Nao e possivel enviar novas mensagens.
            </p>
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="Digite uma mensagem..."
                rows={1}
                maxLength={4000}
                disabled={sending}
                className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60 max-h-28"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="p-2.5 bg-indigo-600 text-white rounded-xl disabled:opacity-50 hover:bg-indigo-700 active:scale-95 transition"
                aria-label="Enviar"
              >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
