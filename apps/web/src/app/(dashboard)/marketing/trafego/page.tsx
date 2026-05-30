'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, RefreshCw, Globe, AlertCircle, MessageCircle } from 'lucide-react'

type ChannelBreakdown = {
  google_ads: number
  microsoft_ads: number
  meta_ads: number
  linkedin_ads: number
  x_ads: number
  tiktok_ads: number
  organic: number
  direct: number
  email: number
  referral: number
  social: number
  other: number
  total: number
  // CWT-first 2026-05-28: campos novos opcionais (backwards-compat)
  topKeywords?: string[]
  source?: 'cwt' | 'ga4_fallback'
  // Fase 2 2026-05-28: top campanhas Google Ads enriquecidas
  topCampaigns?: string[]
}

type SiteTraffic = {
  site: string
  propertyId: string
  configured: boolean
  today: ChannelBreakdown
  yesterday: ChannelBreakdown
  last7d: ChannelBreakdown
  last30d: ChannelBreakdown
  activeNow: number
  error?: string
}

type ApiResponse = {
  generatedAt: string
  leadEvent: string
  sites: SiteTraffic[]
  cached: boolean
}

type Period = 'today' | 'last7d' | 'last30d'

const CHANNELS: { key: keyof Omit<ChannelBreakdown, 'total'>; label: string; emoji: string; color: string }[] = [
  { key: 'google_ads', label: 'Google Ads', emoji: '🔵', color: 'bg-blue-100 text-blue-800' },
  { key: 'microsoft_ads', label: 'Microsoft Ads', emoji: '🔷', color: 'bg-cyan-100 text-cyan-800' },
  { key: 'meta_ads', label: 'Meta Ads', emoji: '🟦', color: 'bg-indigo-100 text-indigo-800' },
  { key: 'linkedin_ads', label: 'LinkedIn Ads', emoji: '💼', color: 'bg-sky-100 text-sky-800' },
  { key: 'x_ads', label: 'X Ads', emoji: '✖️', color: 'bg-zinc-100 text-zinc-800' },
  { key: 'tiktok_ads', label: 'TikTok Ads', emoji: '🎵', color: 'bg-rose-100 text-rose-800' },
  { key: 'organic', label: 'Orgânico', emoji: '🌱', color: 'bg-green-100 text-green-800' },
  { key: 'email', label: 'Email', emoji: '📧', color: 'bg-purple-100 text-purple-800' },
  { key: 'social', label: 'Social orgânico', emoji: '📱', color: 'bg-pink-100 text-pink-800' },
  { key: 'direct', label: 'Direto', emoji: '🔘', color: 'bg-gray-100 text-gray-800' },
  { key: 'referral', label: 'Referral', emoji: '🔗', color: 'bg-orange-100 text-orange-800' },
  { key: 'other', label: 'Não classificado', emoji: '⚪', color: 'bg-slate-100 text-slate-800' },
]

export default function MarketingTrafegoPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const [period, setPeriod] = useState<Period>('last30d')

  const fetchData = async () => {
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/marketing/traffic-realtime', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json.data ?? json)
      setLastFetch(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link href="/marketing" className="text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 text-sm">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 flex items-center gap-2">
              <MessageCircle className="w-6 h-6 text-green-600" />
              Leads de WhatsApp por canal
            </h1>
            <p className="text-sm text-gray-500">De onde vêm os cliques no botão WhatsApp em cada site</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastFetch && (
            <span className="text-xs text-gray-400">
              Atualizado {lastFetch.toLocaleTimeString('pt-BR')}{data?.cached ? ' (cache)' : ''}
            </span>
          )}
          <button
            type="button"
            onClick={fetchData}
            disabled={refreshing}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Period selector */}
      <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {([
          { value: 'today', label: 'Hoje' },
          { value: 'last7d', label: '7 dias' },
          { value: 'last30d', label: '30 dias' },
        ] as { value: Period; label: string }[]).map(p => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPeriod(p.value)}
            className={`px-3 py-1.5 text-sm rounded-md transition ${
              period === p.value
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
          Erro: {error}
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data?.sites.map(site => {
          const breakdown = site[period]
          return (
            <div key={site.site} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-gray-400" />
                  <h2 className="font-medium text-gray-900">{site.site}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {site.activeNow > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      {site.activeNow} agora
                    </span>
                  )}
                </div>
              </div>

              {!site.configured ? (
                <div className="p-4 flex items-start gap-3 bg-amber-50">
                  <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-900">
                    <p className="font-medium mb-1">Evento <code className="bg-amber-100 px-1 rounded">whatsapp_click</code> não configurado</p>
                    <p className="text-xs text-amber-700">
                      A tag GA4 deste site dispara apenas <code>click</code> genérico, sem diferenciar WhatsApp.
                      Pra trackear, atualizar o container GTM com tag GA4 Event &quot;whatsapp_click&quot; no trigger Click - WhatsApp.
                    </p>
                  </div>
                </div>
              ) : site.error ? (
                <div className="p-4 text-sm text-red-600">{site.error}</div>
              ) : breakdown.total === 0 ? (
                <div className="p-4 text-sm text-gray-400 text-center">Sem leads neste período</div>
              ) : (
                <div className="p-4">
                  <div className="mb-3 flex items-baseline justify-between">
                    <span className="text-2xl font-semibold text-gray-900">{breakdown.total}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">leads via WhatsApp</span>
                      {breakdown.source && (
                        <span
                          title={breakdown.source === 'cwt'
                            ? 'Dado server-side (CWT) — atribuição precisa, sem perdas por ad-blocker/consent'
                            : 'Dado GA4 client-side — atribuição parcial (consent/blockers podem ter mascarado origem)'}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            breakdown.source === 'cwt'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {breakdown.source === 'cwt' ? 'CWT' : 'GA4'}
                        </span>
                      )}
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                        <th className="py-2 font-medium">Canal</th>
                        <th className="py-2 font-medium text-right">Leads</th>
                        <th className="py-2 font-medium text-right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CHANNELS.map(ch => {
                        // Eco audit W7 (2026-05-30): Number() pra garantir tipo
                        // primitive number (defesa contra schema drift de breakdown).
                        const count = Number(breakdown[ch.key] ?? 0)
                        if (count === 0) return null
                        const total = Number(breakdown.total ?? 0) || 1
                        const pct = (count / total) * 100
                        return (
                          <tr key={ch.key} className="border-b border-gray-50 last:border-0">
                            <td className="py-2">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${ch.color}`}>
                                <span>{ch.emoji}</span>
                                {ch.label}
                              </span>
                            </td>
                            <td className="py-2 text-right font-mono font-semibold text-gray-900">{count}</td>
                            <td className="py-2 text-right text-xs text-gray-500">{pct.toFixed(1)}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {breakdown.topCampaigns && breakdown.topCampaigns.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                        <span>🔵</span> Top campanhas Google Ads
                      </div>
                      <ul className="space-y-1">
                        {breakdown.topCampaigns.map((c, i) => (
                          <li key={i} className="text-xs text-gray-700 leading-snug" title={c}>
                            <span className="text-gray-400 mr-1">›</span>{c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {breakdown.topKeywords && breakdown.topKeywords.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                        Top palavras-chave
                      </div>
                      <ul className="space-y-1">
                        {breakdown.topKeywords.map((kw, i) => (
                          <li key={i} className="text-xs text-gray-700 truncate" title={kw}>
                            <span className="text-gray-400 mr-1">›</span>{kw}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-6 text-xs text-gray-400 text-center">
        Métrica: event <code>{data?.leadEvent}</code> ·
        fonte <span className="text-emerald-600 font-medium">CWT (server-side)</span>{' '}
        com fallback <span className="text-amber-600 font-medium">GA4</span> · atualiza a cada 60s
      </div>
    </div>
  )
}
