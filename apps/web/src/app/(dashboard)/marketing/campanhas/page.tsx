'use client'

import { useEffect, useState } from 'react'
import { Loader2, Send, CheckCheck, Mail, MousePointerClick, AlertTriangle, TrendingUp } from 'lucide-react'

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

function fmtDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('pt-BR')
}

function fmtPct(n: number) {
  return n.toFixed(1) + '%'
}

function rateColor(rate: number, type: 'delivery' | 'open' | 'click' | 'bounce') {
  // Benchmarks email marketing 2026
  const thresholds = {
    delivery: { good: 95, ok: 90 },
    open: { good: 20, ok: 10 },
    click: { good: 3, ok: 1 },
    bounce: { good: 2, ok: 5 }, // invertido: menor=melhor
  }
  const t = thresholds[type]
  if (type === 'bounce') {
    if (rate <= t.good) return 'text-green-600 dark:text-green-400'
    if (rate <= t.ok) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
  }
  if (rate >= t.good) return 'text-green-600 dark:text-green-400'
  if (rate >= t.ok) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
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

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Marketing — Campanhas</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Histórico de envios agrupados por tag <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">campaign</code> nos payloads do Resend.
        </p>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm text-gray-500">Nenhuma campanha registrada ainda.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                <th className="px-3 py-2">Campanha</th>
                <th className="px-3 py-2 text-right"><Send className="inline h-3 w-3" /> Enviados</th>
                <th className="px-3 py-2 text-right"><CheckCheck className="inline h-3 w-3" /> Delivery</th>
                <th className="px-3 py-2 text-right"><Mail className="inline h-3 w-3" /> Open</th>
                <th className="px-3 py-2 text-right"><MousePointerClick className="inline h-3 w-3" /> Click</th>
                <th className="px-3 py-2 text-right"><AlertTriangle className="inline h-3 w-3" /> Bounce</th>
                <th className="px-3 py-2 text-right">Únicos</th>
                <th className="px-3 py-2">Período</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.campaign} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="px-3 py-3">
                    <div className="font-mono text-xs text-gray-900 dark:text-gray-100">{c.campaign}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-900 dark:text-gray-100">{c.sent.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="tabular-nums">{c.delivered.toLocaleString('pt-BR')}</div>
                    <div className={`text-xs ${rateColor(c.rates.delivery, 'delivery')}`}>{fmtPct(c.rates.delivery)}</div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="tabular-nums">{c.opened.toLocaleString('pt-BR')}</div>
                    <div className={`text-xs ${rateColor(c.rates.open, 'open')}`}>{fmtPct(c.rates.open)}</div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="tabular-nums">{c.clicked.toLocaleString('pt-BR')}</div>
                    <div className={`text-xs ${rateColor(c.rates.click, 'click')}`}>{fmtPct(c.rates.click)}</div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="tabular-nums">{c.bounced.toLocaleString('pt-BR')}</div>
                    <div className={`text-xs ${rateColor(c.rates.bounce, 'bounce')}`}>{fmtPct(c.rates.bounce)}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-500">{c.unique_emails.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {fmtDate(c.first_at)}
                    {c.first_at !== c.last_at && ` → ${fmtDate(c.last_at)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
        <strong>Benchmarks 2026:</strong> Delivery &gt;95% bom · Open &gt;20% bom · Click &gt;3% bom · Bounce &lt;2% bom (Resend pausa em &gt;5%).
        <br/>
        <strong>Nota:</strong> click_tracking está DESABILITADO no domínio (auditoria 13/05) — open ainda funciona via pixel, mas click rate sempre 0% até reativar tracking subdomain.
      </div>
    </div>
  )
}
