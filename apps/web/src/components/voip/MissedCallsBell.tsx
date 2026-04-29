'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PhoneMissed, RotateCw } from 'lucide-react'

interface RecentMissed {
  id: string
  from_number: string
  to_number: string
  direction: string
  status: string
  started_at: string
  customers?: { id: string; legal_name: string; trade_name: string | null } | null
}

interface StatsResponse {
  data?: {
    missedCount: number
    recentMissed: RecentMissed[]
  }
  error?: string
}

function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '—'
  const d = raw.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return raw
}

function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function MissedCallsBell() {
  const [count, setCount] = useState(0)
  const [recent, setRecent] = useState<RecentMissed[]>([])
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  async function refresh() {
    try {
      const r = await fetch('/api/voip/calls/stats', { cache: 'no-store' })
      if (!r.ok) return
      const j: StatsResponse = await r.json()
      if (j.data) {
        setCount(j.data.missedCount)
        setRecent(j.data.recentMissed)
      }
    } catch {
      // ignora — atualizamos no proximo SSE event
    }
  }

  useEffect(() => {
    refresh()
    // a cada 60s pra cobrir caso de SSE perdido
    const interval = setInterval(refresh, 60_000)
    return () => clearInterval(interval)
  }, [])

  // SSE: se evento call.missed chegar, refresh imediato
  useEffect(() => {
    if (typeof window === 'undefined') return
    let stopped = false
    let retryDelay = 1000

    function connect() {
      if (stopped) return
      const es = new EventSource('/api/voip/calls/stream')
      es.onopen = () => { retryDelay = 1000 }
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data)
          if (ev.type === 'call.missed' || ev.type === 'call.answered' || ev.type === 'call.start') {
            refresh()
          }
        } catch {}
      }
      es.onerror = () => {
        es.close()
        if (stopped) return
        setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30_000)
      }
    }

    connect()
    return () => { stopped = true }
  }, [])

  // Click fora fecha popover
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
        aria-label={`${count} chamadas perdidas`}
      >
        <PhoneMissed className={`h-5 w-5 ${count > 0 ? 'text-red-600' : 'text-gray-500'}`} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center text-[10px] font-bold text-white bg-red-600 rounded-full">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-md border bg-white shadow-lg dark:bg-gray-800 dark:border-gray-700">
          <div className="border-b px-3 py-2 flex items-center justify-between dark:border-gray-700">
            <span className="text-sm font-semibold dark:text-gray-100">Chamadas perdidas (24h)</span>
            <Link
              href="/voip/calls?status=missed"
              onClick={() => setOpen(false)}
              className="text-xs text-blue-600 hover:underline"
            >
              Ver todas
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-400">Nenhuma perdida nas últimas 24h</div>
          ) : (
            <ul className="max-h-72 overflow-y-auto divide-y dark:divide-gray-700">
              {recent.map(c => {
                const phone = c.direction === 'inbound' ? c.from_number : c.to_number
                const name = c.customers?.trade_name || c.customers?.legal_name
                return (
                  <li key={c.id} className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/voip/calls/${c.id}`}
                          onClick={() => setOpen(false)}
                          className="block"
                        >
                          <div className="text-sm font-medium truncate dark:text-gray-100">
                            {name || <span className="text-gray-500 italic">Cliente não identificado</span>}
                          </div>
                          <div className="text-xs text-gray-500 font-mono">{formatPhone(phone)}</div>
                          <div className="text-xs text-gray-400">{relativeTime(c.started_at)}</div>
                        </Link>
                      </div>
                      <a
                        href={`tel:${phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-red-600 hover:bg-red-700 text-white"
                        title="Retornar ligação"
                      >
                        <RotateCw className="h-3 w-3" /> Retornar
                      </a>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
