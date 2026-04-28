'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, RefreshCw, Clock } from 'lucide-react'

type Alert = {
  id: string
  driver_id: string
  driver_name: string
  last_gps_at: string | null
  minutes_since_last_gps: number
  alerted_at: string
}

/**
 * /logistica/alertas — Painel de alertas de inatividade
 *
 * Lista os alertas que o cron driver-inactivity gerou nos ultimos N dias
 * (default 7d). Cada alerta corresponde a um motorista com notify_inactivity=true
 * que ficou >30min sem GPS em horario comercial.
 *
 * Operadores podem usar pra: ver historico, identificar motoristas
 * problematicos, validar que sistema de alertas esta funcionando.
 */
export default function AlertasPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(true)

  async function fetchAlerts(d = days) {
    setLoading(true)
    try {
      const res = await fetch(`/api/logistica/alertas?days=${d}`, { cache: 'no-store' })
      if (!res.ok) return
      const { data } = await res.json()
      setAlerts(data.alerts || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchAlerts() }, []) // eslint-disable-line

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/logistica" className="rounded-lg border p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          Alertas de Inatividade
        </h1>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Periodo:</span>
            {[1, 7, 14, 30].map(d => (
              <button key={d} type="button"
                onClick={() => { setDays(d); fetchAlerts(d) }}
                className={`px-3 py-1 rounded-full text-xs font-medium ${days === d ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {d === 1 ? '24h' : `${d} dias`}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => fetchAlerts()} disabled={loading}
            aria-label="Atualizar" title="Atualizar"
            className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading && alerts.length === 0 ? (
          <div className="py-12 text-center text-gray-400">Carregando...</div>
        ) : alerts.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <AlertTriangle className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="font-medium">Nenhum alerta nos ultimos {days === 1 ? '24h' : `${days} dias`}</p>
            <p className="text-xs mt-1">Significa que motoristas com opt-in estao reportando GPS normalmente.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map(a => {
              const alertDate = new Date(a.alerted_at)
              const lastGpsDate = a.last_gps_at ? new Date(a.last_gps_at) : null
              return (
                <div key={a.id} className="border border-amber-200 bg-amber-50/50 rounded-lg p-3 flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900">{a.driver_name}</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      <Clock className="w-3 h-3 inline mr-1" />
                      Sem GPS por <strong>{a.minutes_since_last_gps} min</strong>
                      {lastGpsDate && ` — ultimo sinal: ${lastGpsDate.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`}
                    </p>
                  </div>
                  <div className="text-[10px] text-gray-400 text-right shrink-0">
                    <p>Alerta enviado:</p>
                    <p className="font-mono">{alertDate.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
