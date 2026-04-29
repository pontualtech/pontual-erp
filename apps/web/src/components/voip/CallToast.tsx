'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneCall, X, ExternalLink, RotateCw } from 'lucide-react'

type VoipEvent = {
  type: 'hello' | 'call.start' | 'call.answered' | 'call.missed' | 'call.completed'
  ts?: number
  voipCallId?: string
  callId?: string
  direction?: 'inbound' | 'outbound'
  fromNumber?: string
  toNumber?: string
  customerId?: string | null
  customerName?: string | null
  agentExtension?: string | null
  status?: string
  startedAt?: string
}

type ActiveToast = {
  uid: string
  kind: 'ringing' | 'answered' | 'missed'
  voipCallId: string
  customerId: string | null
  customerName: string | null
  externalNumber: string
  direction: 'inbound' | 'outbound'
  startedAt: number
}

function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '—'
  const d = raw.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return raw
}

export function CallToast() {
  const [toasts, setToasts] = useState<ActiveToast[]>([])
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    let stopped = false
    let retryDelay = 1000

    function connect() {
      if (stopped) return
      const es = new EventSource('/api/voip/calls/stream')
      esRef.current = es

      es.onopen = () => { retryDelay = 1000 }

      es.onmessage = (e) => {
        let ev: VoipEvent
        try { ev = JSON.parse(e.data) } catch { return }
        if (ev.type === 'hello') return

        const externalNumber = ev.direction === 'inbound'
          ? (ev.fromNumber || '')
          : (ev.toNumber || '')

        if (ev.type === 'call.start') {
          setToasts(prev => addOrReplace(prev, {
            uid: ev.voipCallId || ev.callId || crypto.randomUUID(),
            kind: 'ringing',
            voipCallId: ev.voipCallId || '',
            customerId: ev.customerId ?? null,
            customerName: ev.customerName ?? null,
            externalNumber,
            direction: (ev.direction || 'inbound') as 'inbound' | 'outbound',
            startedAt: Date.now(),
          }))
        } else if (ev.type === 'call.missed') {
          setToasts(prev => addOrReplace(prev, {
            uid: ev.voipCallId || ev.callId || crypto.randomUUID(),
            kind: 'missed',
            voipCallId: ev.voipCallId || '',
            customerId: ev.customerId ?? null,
            customerName: ev.customerName ?? null,
            externalNumber,
            direction: (ev.direction || 'inbound') as 'inbound' | 'outbound',
            startedAt: Date.now(),
          }))
        } else if (ev.type === 'call.answered' || ev.type === 'call.completed') {
          setToasts(prev => addOrReplace(prev, {
            uid: ev.voipCallId || ev.callId || crypto.randomUUID(),
            kind: 'answered',
            voipCallId: ev.voipCallId || '',
            customerId: ev.customerId ?? null,
            customerName: ev.customerName ?? null,
            externalNumber,
            direction: (ev.direction || 'inbound') as 'inbound' | 'outbound',
            startedAt: Date.now(),
          }))
        }
      }

      es.onerror = () => {
        es.close()
        if (stopped) return
        setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30_000) // exp backoff até 30s
      }
    }

    connect()

    return () => {
      stopped = true
      esRef.current?.close()
    }
  }, [])

  // Auto-dismiss: ringing 60s, missed 5min (precisa atenção), answered 10s
  useEffect(() => {
    if (toasts.length === 0) return
    const now = Date.now()
    const timers = toasts.map(t => {
      const ttl = t.kind === 'missed' ? 300_000 : t.kind === 'answered' ? 10_000 : 60_000
      const remaining = Math.max(0, ttl - (now - t.startedAt))
      return setTimeout(() => {
        setToasts(prev => prev.filter(x => x.uid !== t.uid))
      }, remaining)
    })
    return () => { timers.forEach(clearTimeout) }
  }, [toasts])

  const dismiss = (uid: string) => setToasts(prev => prev.filter(t => t.uid !== uid))

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] space-y-2 max-w-sm">
      {toasts.map(t => {
        const isMissed = t.kind === 'missed'
        const isRinging = t.kind === 'ringing'
        const colors = isMissed
          ? 'bg-red-50 border-red-300 text-red-900 dark:bg-red-950 dark:border-red-800 dark:text-red-100'
          : isRinging
            ? 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100'
            : 'bg-green-50 border-green-300 text-green-900 dark:bg-green-950 dark:border-green-800 dark:text-green-100'

        const Icon = isMissed
          ? PhoneMissed
          : t.direction === 'outbound'
            ? PhoneOutgoing
            : isRinging ? PhoneCall : PhoneIncoming

        const title = isMissed
          ? '❌ Chamada perdida'
          : isRinging
            ? (t.direction === 'inbound' ? '📞 Tocando — chamada recebida' : '📞 Chamando…')
            : '✓ Chamada atendida'

        return (
          <div
            key={t.uid}
            className={`rounded-lg border-2 shadow-lg p-3 animate-in slide-in-from-right-4 duration-300 ${colors} ${isRinging ? 'animate-pulse' : ''}`}
          >
            <div className="flex items-start gap-2">
              <Icon className={`h-5 w-5 mt-0.5 ${isRinging ? 'animate-bounce' : ''}`} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{title}</div>
                <div className="mt-1 text-sm">
                  {t.customerName ? (
                    <div className="font-medium truncate">{t.customerName}</div>
                  ) : (
                    <div className="italic opacity-70">Cliente não identificado</div>
                  )}
                  <div className="font-mono text-xs opacity-80">{formatPhone(t.externalNumber)}</div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.customerId && (
                    <Link
                      href={`/clientes/${t.customerId}`}
                      onClick={() => dismiss(t.uid)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-white/60 hover:bg-white/90 dark:bg-black/30 dark:hover:bg-black/60"
                    >
                      <ExternalLink className="h-3 w-3" /> Abrir cliente
                    </Link>
                  )}
                  {t.voipCallId && (
                    <Link
                      href={`/voip/calls/${t.voipCallId}`}
                      onClick={() => dismiss(t.uid)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-white/60 hover:bg-white/90 dark:bg-black/30 dark:hover:bg-black/60"
                    >
                      Detalhes
                    </Link>
                  )}
                  {isMissed && (
                    <a
                      href={`tel:${t.externalNumber}`}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-red-600 hover:bg-red-700 text-white"
                    >
                      <RotateCw className="h-3 w-3" /> Retornar
                    </a>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.uid)}
                className="opacity-50 hover:opacity-100 -mr-1 -mt-1 p-1"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function addOrReplace(arr: ActiveToast[], next: ActiveToast): ActiveToast[] {
  const idx = arr.findIndex(t => t.uid === next.uid)
  if (idx === -1) return [...arr, next]
  // Mesma chamada que evolui de ringing → answered/missed: substitui in-place
  const copy = [...arr]
  copy[idx] = next
  return copy
}
