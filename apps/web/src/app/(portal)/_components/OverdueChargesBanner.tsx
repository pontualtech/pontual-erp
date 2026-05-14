'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, ExternalLink } from 'lucide-react'

interface Cobranca {
  id: string
  description: string
  amount_cents: number
  due_date: string
  charge_url: string | null
  charge_status: string | null
  service_order_id: string | null
  os_number: number | null
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

/**
 * Banner de alerta de cobrancas vencidas pro cliente no portal.
 * Mostrado em /portal/[slug] (home) e /portal/[slug]/os/[id].
 *
 * Filtrar por OS especifica: passar `osId` (so mostra cobranca daquela OS).
 * Sem `osId`: mostra todas vencidas do cliente.
 *
 * Acao unica: "Pagar agora" → abre charge_url Asaas em nova aba.
 *
 * Feature 2026-05-14 (feat 6/7).
 */
export function OverdueChargesBanner({ osId }: { osId?: string }) {
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/portal/cobrancas-vencidas')
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        let list: Cobranca[] = res?.data || []
        if (osId) list = list.filter(c => c.service_order_id === osId)
        setCobrancas(list)
      })
      .catch(() => setCobrancas([]))
      .finally(() => setLoading(false))
  }, [osId])

  if (loading || cobrancas.length === 0) return null

  return (
    <div className="rounded-xl border-2 border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-red-900 dark:text-red-200">
            {cobrancas.length === 1
              ? 'Você tem 1 cobrança vencida'
              : `Você tem ${cobrancas.length} cobranças vencidas`}
          </h3>
          <p className="text-sm text-red-700 dark:text-red-300 mt-0.5">
            Pague agora pra evitar atrasos no atendimento.
          </p>
          <div className="mt-3 space-y-2">
            {cobrancas.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-zinc-900 px-3 py-2 border border-red-200 dark:border-red-900">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {c.os_number ? `OS #${c.os_number} — ` : ''}{c.description}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Venceu em {fmtDate(c.due_date)} · <span className="font-bold text-red-700 dark:text-red-400">{fmt(c.amount_cents)}</span>
                  </p>
                </div>
                {c.charge_url ? (
                  <a
                    href={c.charge_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg"
                  >
                    Pagar agora
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <span className="flex-shrink-0 text-xs text-gray-400 italic">Sem link</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
