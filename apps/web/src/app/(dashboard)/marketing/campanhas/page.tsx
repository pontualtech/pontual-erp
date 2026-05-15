'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, Send, CheckCheck, Mail, MousePointerClick, AlertTriangle,
  TrendingUp, Megaphone,
} from 'lucide-react'
import { StatCard } from '@/components/marketing/StatCard'
import { EmptyState } from '@/components/marketing/EmptyState'
import { formatNumber, formatDateShort, formatRelative } from '@/lib/marketing/format'

interface Campaign {
  campaign: string
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  unique_emails: number
  first_at: string
  last_at: string
  rates: { delivery: number; open: number; click: number; bounce: number }
}

function fmtPct(n: number) {
  return n.toFixed(1) + '%'
}

function rateColor(rate: number, type: 'delivery' | 'open' | 'click' | 'bounce') {
  const thresholds = {
    delivery: { good: 95, ok: 90 },
    open: { good: 20, ok: 10 },
    click: { good: 3, ok: 1 },
    bounce: { good: 2, ok: 5 },
  }
  const t = thresholds[type]
  if (type === 'bounce') {
    if (rate <= t.good) return 'text-green-600 dark:text-green-400'
    if (rate <= t.ok) return 'text-amber-600 dark:text-amber-400'
    return 'text-red-600 dark:text-red-400'
  }
  if (rate >= t.good) return 'text-green-600 dark:text-green-400'
  if (rate >= t.ok) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

/** Renderiza barra horizontal de proporção (delivery vs bounce) */
function MiniBar({ delivered, bounced, sent }: { delivered: number; bounced: number; sent: number }) {
  const dPct = sent > 0 ? (delivered / sent) * 100 : 0
  const bPct = sent > 0 ? (bounced / sent) * 100 : 0
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
      <div className="bg-green-500" style={{ width: `${dPct}%` }} title={`Entregues: ${delivered}`} />
      <div className="bg-red-500" style={{ width: `${bPct}%` }} title={`Bounces: ${bounced}`} />
    </div>
  )
}

export default function CampanhasPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const r = await fetch('/api/marketing/campanhas')
        if (r.ok) setCampaigns((await r.json()).data?.campaigns || [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Agregar totais pra stat cards
  const totals = useMemo(() => {
    if (!campaigns.length) return null
    const sent = campaigns.reduce((s, c) => s + c.sent, 0)
    const delivered = campaigns.reduce((s, c) => s + c.delivered, 0)
    const opened = campaigns.reduce((s, c) => s + c.opened, 0)
    const bounced = campaigns.reduce((s, c) => s + c.bounced, 0)
    return {
      campaigns: campaigns.length,
      sent,
      delivered,
      opened,
      bounced,
      deliveryRate: sent > 0 ? (delivered / sent) * 100 : 0,
      openRate: delivered > 0 ? (opened / delivered) * 100 : 0,
      bounceRate: sent > 0 ? (bounced / sent) * 100 : 0,
    }
  }, [campaigns])

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 p-2.5 text-white shadow-sm">
          <Megaphone className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Campanhas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Histórico de envios agrupados por tag <code className="rounded bg-gray-100 px-1 text-[11px] dark:bg-gray-800">campaign</code> nos payloads do Resend.
          </p>
        </div>
      </div>

      {/* Stats agregadas */}
      {loading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : totals ? (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Campanhas únicas"
            value={totals.campaigns}
            icon={Megaphone}
            tone="default"
          />
          <StatCard
            label="Total enviado"
            value={totals.sent}
            hint={`${formatNumber(totals.delivered)} entregues`}
            icon={Send}
            tone="blue"
          />
          <StatCard
            label="Delivery médio"
            value={`${totals.deliveryRate.toFixed(1)}%`}
            hint={totals.deliveryRate >= 95 ? 'Excelente' : totals.deliveryRate >= 90 ? 'OK' : 'Atenção'}
            icon={CheckCheck}
            tone={totals.deliveryRate >= 95 ? 'green' : totals.deliveryRate >= 90 ? 'amber' : 'rose'}
          />
          <StatCard
            label="Bounce médio"
            value={`${totals.bounceRate.toFixed(2)}%`}
            hint={totals.bounceRate > 5 ? '⚠️ Resend pode pausar (>5%)' : totals.bounceRate > 2 ? 'Atenção' : 'OK'}
            icon={AlertTriangle}
            tone={totals.bounceRate > 5 ? 'rose' : totals.bounceRate > 2 ? 'amber' : 'green'}
          />
        </div>
      ) : null}

      {/* Tabela ou Empty */}
      {!loading && campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Nenhuma campanha registrada ainda"
          description="Campanhas aparecem aqui automaticamente quando você dispara emails via Resend com tag 'campaign'. Use os scripts node send_warmup_day.js, ou agende via Mautic."
        />
      ) : !loading && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3 font-medium">Campanha</th>
                  <th className="px-3 py-3 text-right font-medium"><Send className="inline h-3 w-3" /> Enviados</th>
                  <th className="px-3 py-3 text-right font-medium"><CheckCheck className="inline h-3 w-3" /> Delivery</th>
                  <th className="px-3 py-3 text-right font-medium"><Mail className="inline h-3 w-3" /> Open</th>
                  <th className="px-3 py-3 text-right font-medium"><MousePointerClick className="inline h-3 w-3" /> Click</th>
                  <th className="px-3 py-3 text-right font-medium"><AlertTriangle className="inline h-3 w-3" /> Bounce</th>
                  <th className="px-3 py-3 text-right font-medium">Únicos</th>
                  <th className="px-4 py-3 font-medium">Período</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {campaigns.map(c => (
                  <tr key={c.campaign} className="hover:bg-gray-50 dark:hover:bg-gray-900/40">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-medium text-gray-900 dark:text-gray-100">{c.campaign}</div>
                      <div className="mt-1.5 max-w-[180px]">
                        <MiniBar delivered={c.delivered} bounced={c.bounced} sent={c.sent} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="font-medium tabular-nums text-gray-900 dark:text-gray-100">
                        {formatNumber(c.sent)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="tabular-nums text-gray-700 dark:text-gray-300">{formatNumber(c.delivered)}</div>
                      <div className={`text-xs font-semibold ${rateColor(c.rates.delivery, 'delivery')}`}>{fmtPct(c.rates.delivery)}</div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="tabular-nums text-gray-700 dark:text-gray-300">{formatNumber(c.opened)}</div>
                      <div className={`text-xs font-semibold ${rateColor(c.rates.open, 'open')}`}>{fmtPct(c.rates.open)}</div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="tabular-nums text-gray-700 dark:text-gray-300">{formatNumber(c.clicked)}</div>
                      <div className={`text-xs font-semibold ${rateColor(c.rates.click, 'click')}`}>{fmtPct(c.rates.click)}</div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="tabular-nums text-gray-700 dark:text-gray-300">{formatNumber(c.bounced)}</div>
                      <div className={`text-xs font-semibold ${rateColor(c.rates.bounce, 'bounce')}`}>{fmtPct(c.rates.bounce)}</div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs text-gray-500">{formatNumber(c.unique_emails)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500" title={`${formatDateShort(c.first_at)} → ${formatDateShort(c.last_at)}`}>
                      {c.first_at === c.last_at
                        ? formatRelative(c.first_at)
                        : <>
                            <div>{formatDateShort(c.first_at)}</div>
                            <div className="text-gray-400">→ {formatDateShort(c.last_at)}</div>
                          </>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Notas informativas */}
      <div className="mt-6 space-y-2">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900/50 dark:bg-blue-500/10 dark:text-blue-300">
          <div className="flex items-start gap-2">
            <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <strong>Benchmarks 2026:</strong> Delivery &gt;95% bom · Open &gt;20% bom · Click &gt;3% bom · Bounce &lt;2% bom (Resend pausa em &gt;5%).
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
