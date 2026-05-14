'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CreditCard, AlertCircle, CheckCircle2, Send } from 'lucide-react'

interface Summary {
  vencidas: { sum: number; count: number }
  aguardando: { sum: number; count: number }
  pagas_hoje: { sum: number; count: number }
  enviadas_hoje: { count: number }
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

/**
 * Widget Dashboard de Cobrancas Asaas (feature 2026-05-14 feat 3/4).
 *
 * 4 metricas resumidas com link pra listagem ja filtrada:
 *  - Vencidas (charge_status=OVERDUE) → /financeiro/contas-receber?chargeStatus=OVERDUE
 *  - Aguardando pgto (PENDING)        → ?chargeStatus=PENDING
 *  - Pagas hoje                       → ?chargeStatus=RECEIVED
 *  - Enviadas hoje (count only)       → ?chargeStatus=PENDING (mesmo destino)
 */
export function ChargesSummaryWidget() {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/financeiro/cobrancas/summary')
      .then(r => r.ok ? r.json() : null)
      .then(res => setData(res?.data ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const items = [
    {
      label: 'Cobranças vencidas',
      sum: data?.vencidas.sum ?? 0,
      count: data?.vencidas.count ?? 0,
      href: '/financeiro/contas-receber?chargeStatus=OVERDUE',
      icon: AlertCircle,
      color: 'text-red-700 bg-red-50 border-red-200',
      iconColor: 'text-red-500',
    },
    {
      label: 'Aguardando pagamento',
      sum: data?.aguardando.sum ?? 0,
      count: data?.aguardando.count ?? 0,
      href: '/financeiro/contas-receber?chargeStatus=PENDING',
      icon: CreditCard,
      color: 'text-amber-800 bg-amber-50 border-amber-200',
      iconColor: 'text-amber-500',
    },
    {
      label: 'Pagas hoje',
      sum: data?.pagas_hoje.sum ?? 0,
      count: data?.pagas_hoje.count ?? 0,
      href: '/financeiro/contas-receber?chargeStatus=RECEIVED',
      icon: CheckCircle2,
      color: 'text-emerald-800 bg-emerald-50 border-emerald-200',
      iconColor: 'text-emerald-500',
    },
    {
      label: 'Enviadas hoje',
      sum: null as number | null,
      count: data?.enviadas_hoje.count ?? 0,
      href: '/financeiro/contas-receber?chargeStatus=PENDING',
      icon: Send,
      color: 'text-blue-800 bg-blue-50 border-blue-200',
      iconColor: 'text-blue-500',
    },
  ]

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <CreditCard className="h-5 w-5 text-emerald-600" />
        <h2 className="font-semibold text-gray-900">Cobranças Asaas</h2>
      </div>
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-4">Carregando...</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {items.map(it => (
            <Link
              key={it.label}
              href={it.href}
              className={`block rounded-lg border p-3 hover:shadow-sm transition-shadow ${it.color}`}
            >
              <div className="flex items-start gap-2">
                <it.icon className={`h-4 w-4 ${it.iconColor} mt-0.5 flex-shrink-0`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium leading-tight">{it.label}</p>
                  {it.sum !== null ? (
                    <p className="text-base font-bold mt-1">{fmt(it.sum)}</p>
                  ) : null}
                  <p className="text-[11px] opacity-70 mt-0.5">{it.count} {it.count === 1 ? 'cobrança' : 'cobranças'}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
