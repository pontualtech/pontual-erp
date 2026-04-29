'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, ArrowRight } from 'lucide-react'

interface Stats {
  today: {
    total: number
    answered: number
    missed: number
    outbound: number
    avgDurationSec: number
  }
  missedCount: number
}

function formatDuration(s: number): string {
  if (!s) return '0s'
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m === 0) return `${sec}s`
  return `${m}m ${sec}s`
}

export function VoipDashboardCard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      const r = await fetch('/api/voip/calls/stats', { cache: 'no-store' })
      const j = await r.json()
      if (j.data) setStats(j.data)
    } catch {
      // ignora — atualizamos em SSE
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 60_000)
    return () => clearInterval(interval)
  }, [])

  // Atualiza via SSE quando vier evento
  useEffect(() => {
    if (typeof window === 'undefined') return
    let stopped = false
    let retry = 1000
    function connect() {
      if (stopped) return
      const es = new EventSource('/api/voip/calls/stream')
      es.onopen = () => { retry = 1000 }
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data)
          if (ev.type?.startsWith('call.')) refresh()
        } catch {}
      }
      es.onerror = () => {
        es.close()
        if (stopped) return
        setTimeout(connect, retry)
        retry = Math.min(retry * 2, 30_000)
      }
    }
    connect()
    return () => { stopped = true }
  }, [])

  return (
    <div className="rounded-xl border bg-white dark:bg-gray-800 dark:border-gray-700 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900">
            <PhoneCall className="h-4 w-4 text-blue-600 dark:text-blue-300" />
          </div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide">
            Chamadas hoje
          </h2>
        </div>
        <Link
          href="/voip/calls"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          Ver todas <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {loading && !stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-pulse">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="rounded-md bg-gray-100 dark:bg-gray-700 h-16" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric
            label="Total"
            value={stats?.today.total ?? 0}
            icon={PhoneIncoming}
            tone="blue"
            href="/voip/calls"
          />
          <Metric
            label="Atendidas"
            value={stats?.today.answered ?? 0}
            icon={PhoneCall}
            tone="green"
            href="/voip/calls?status=answered"
          />
          <Metric
            label="Perdidas"
            value={stats?.today.missed ?? 0}
            icon={PhoneMissed}
            tone="red"
            href="/voip/calls?status=missed"
            highlight={(stats?.today.missed ?? 0) > 0}
          />
          <Metric
            label="Tempo médio"
            value={formatDuration(stats?.today.avgDurationSec ?? 0)}
            icon={Clock}
            tone="gray"
          />
        </div>
      )}

      {(stats?.today.outbound ?? 0) > 0 && (
        <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
          <PhoneOutgoing className="h-3 w-3" />
          {stats?.today.outbound} {stats?.today.outbound === 1 ? 'realizada' : 'realizadas'} hoje
        </div>
      )}
    </div>
  )
}

interface MetricProps {
  label: string
  value: number | string
  icon: React.ElementType
  tone: 'blue' | 'green' | 'red' | 'gray'
  href?: string
  highlight?: boolean
}

function Metric({ label, value, icon: Icon, tone, href, highlight }: MetricProps) {
  const toneClasses = {
    blue: 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-200',
    green: 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-200',
    red: 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-200',
    gray: 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200',
  }[tone]

  const content = (
    <div className={`rounded-md p-3 ${toneClasses} ${highlight ? 'ring-2 ring-red-400 animate-pulse' : ''}`}>
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4 opacity-70" />
        <span className="text-xl font-bold">{value}</span>
      </div>
      <div className="mt-1 text-xs opacity-75">{label}</div>
    </div>
  )

  return href ? (
    <Link href={href} className="block hover:opacity-90 transition-opacity">{content}</Link>
  ) : content
}
