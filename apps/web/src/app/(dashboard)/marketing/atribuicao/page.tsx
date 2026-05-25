'use client'

import { useEffect, useState, Fragment } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, TrendingUp, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, ArrowRight, Mail, MousePointerClick } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts'

type OrderRef = {
  os_id: string
  os_number: number
  customer_name: string | null
  approved_cost: number
  total_cost: number
  created_at: string
  approved: boolean
}

type ChannelStats = {
  channel: string
  label: string
  emoji: string
  os_count: number
  approved_count: number
  approval_rate: number
  approved_revenue_cents: number
  total_revenue_cents: number
  top_orders: OrderRef[]
  // Sprint UX-16: CAC/ROI por canal (anexados no backend via /api/marketing/attribution)
  investment_cents?: number
  cac_cents?: number | null
  roi_pct?: number | null
}

type TimelineRow = {
  date: string
  google_ads?: number
  microsoft_ads?: number
  meta_ads?: number
  linkedin_ads?: number
  x_ads?: number
  tiktok_ads?: number
  organic?: number
  email?: number
  direct?: number
  social?: number
  referral?: number
  other?: number
}

type ApiResponse = {
  range: string
  since: string
  totals: {
    os_count: number
    approved_count: number
    approved_revenue_cents: number
    total_revenue_cents: number
    tracked_count: number
  }
  breakdown: ChannelStats[]
  timeline: TimelineRow[]
  coverage_pct: number
}

type EmailEngagementItem = {
  id: string
  name: string
  email: string
  phone: string | null
  tags: string[]
  last_opened_at: string | null
  last_clicked_at: string | null
  action: 'clicked' | 'opened'
  customer_id: string | null
  customer_name: string | null
}

type EmailEngagementResponse = {
  window: string
  counts: { total: number; clicked: number; opened_only: number }
  items: EmailEngagementItem[]
}

const CHART_COLORS: Record<string, string> = {
  google_ads: '#3b82f6',     // blue-500
  microsoft_ads: '#06b6d4',  // cyan-500
  meta_ads: '#6366f1',       // indigo-500
  linkedin_ads: '#0ea5e9',   // sky-500
  x_ads: '#71717a',          // zinc-500
  tiktok_ads: '#f43f5e',     // rose-500
  organic: '#10b981',        // emerald-500
  email: '#8b5cf6',          // violet-500
  social: '#ec4899',         // pink-500 (social orgânico)
  direct: '#6b7280',         // gray-500
  referral: '#f59e0b',       // amber-500
  other: '#94a3b8',          // slate-400
}

// Tipos do endpoint /api/marketing/traffic-realtime — só pra agregar funil
type ChannelBreakdownGA4 = {
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
}

type GA4SiteTraffic = {
  site: string
  configured: boolean
  last7d: ChannelBreakdownGA4
  last30d: ChannelBreakdownGA4
}

type GA4Response = {
  leadEvent: string
  sites: GA4SiteTraffic[]
}

// Mapeia channel do GA4 endpoint pro mesmo nome usado no attribution
const CHANNEL_MAP_GA4: Record<keyof Omit<ChannelBreakdownGA4, 'total'>, string> = {
  google_ads: 'google_ads',
  microsoft_ads: 'microsoft_ads',
  organic: 'organic',
  direct: 'direct',
  email: 'email',
  referral: 'referral',
  social: 'social',
  other: 'other',
}

type FunnelRow = {
  channel: string
  label: string
  emoji: string
  clicks_whatsapp: number
  os_count: number
  approved_count: number
  approved_revenue_cents: number
}

type Range = '7d' | '30d' | '90d' | '365d'

const RANGE_LABELS: Record<Range, string> = { '7d': '7 dias', '30d': '30 dias', '90d': '90 dias', '365d': '1 ano' }

function fmtBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

export default function MarketingAttributionPage() {
  const [range, setRange] = useState<Range>('90d')
  const [data, setData] = useState<ApiResponse | null>(null)
  const [ga4, setGa4] = useState<GA4Response | null>(null)
  const [email, setEmail] = useState<EmailEngagementResponse | null>(null)
  const [emailWindow, setEmailWindow] = useState<'24h' | '7d' | '30d'>('7d')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [reloadKey, setReloadKey] = useState(0)

  const toggleExpand = (ch: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(ch)) next.delete(ch)
      else next.add(ch)
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    // Buscamos atribuição (depende do range) + GA4 traffic + email engagement (paralelos)
    Promise.all([
      fetch(`/api/marketing/attribution?range=${range}`).then(r => r.ok ? r.json() : Promise.reject(r)),
      fetch('/api/marketing/traffic-realtime').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/marketing/email-engagement?window=${emailWindow}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([attr, traffic, emailData]) => {
        if (cancelled) return
        setData(attr.data ?? attr)
        if (traffic) setGa4(traffic.data ?? traffic)
        if (emailData) setEmail(emailData.data ?? emailData)
      })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : 'Erro ao carregar'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [range, emailWindow, reloadKey])

  // Sprint UX-16: editar investimento mensal por canal (CAC/ROI)
  async function editInvestment(channel: string, currentCents: number) {
    const currentBRL = currentCents > 0 ? (currentCents / 100).toFixed(2).replace('.', ',') : ''
    const input = window.prompt(
      `Investimento MENSAL no canal "${channel}" (R$).\n\nEx: 1500 ou 1500,50\nDeixe vazio pra zerar.`,
      currentBRL,
    )
    if (input === null) return // cancelou
    const normalized = input.trim().replace(/\./g, '').replace(',', '.')
    const valor = normalized === '' ? 0 : parseFloat(normalized)
    if (!Number.isFinite(valor) || valor < 0) {
      alert('Valor inválido. Use formato 1500 ou 1500,50.')
      return
    }
    const amountCents = Math.round(valor * 100)
    try {
      const res = await fetch('/api/marketing/investment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, amount_cents: amountCents }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`Erro ao salvar: ${err.error || res.statusText}`)
        return
      }
      setReloadKey(k => k + 1)
    } catch (e) {
      alert(`Erro de rede: ${e instanceof Error ? e.message : 'desconhecido'}`)
    }
  }

  // Constrói funil cruzando GA4 (clicks WhatsApp) com ERP (OS + aprovadas)
  // Usa last30d do GA4 quando range é 30d ou maior; last7d quando é 7d
  function buildFunnel(): FunnelRow[] {
    if (!data || !ga4) return []
    const useWindow: 'last7d' | 'last30d' = range === '7d' ? 'last7d' : 'last30d'
    const ga4Totals: Record<string, number> = { google_ads: 0, microsoft_ads: 0, meta_ads: 0, linkedin_ads: 0, x_ads: 0, tiktok_ads: 0, organic: 0, direct: 0, email: 0, referral: 0, social: 0, other: 0 }
    for (const site of ga4.sites) {
      if (!site.configured) continue
      const bd = site[useWindow]
      for (const k of Object.keys(ga4Totals)) {
        ga4Totals[k] += (bd as any)[k] || 0
      }
    }
    // Considera apenas canais que aparecem no breakdown ERP (exceto sem_tracking)
    const rows: FunnelRow[] = []
    for (const b of data.breakdown) {
      if (b.channel === 'sem_tracking') continue
      rows.push({
        channel: b.channel,
        label: b.label,
        emoji: b.emoji,
        clicks_whatsapp: ga4Totals[b.channel] || 0,
        os_count: b.os_count,
        approved_count: b.approved_count,
        approved_revenue_cents: b.approved_revenue_cents,
      })
    }
    return rows.sort((a, b) => b.clicks_whatsapp - a.clicks_whatsapp || b.os_count - a.os_count)
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link href="/marketing" className="text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 text-sm">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-emerald-600" />
              Atribuição de Receita
            </h1>
            <p className="text-sm text-gray-500">OS criadas e aprovadas por canal de origem</p>
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          {(['7d', '30d', '90d', '365d'] as Range[]).map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-sm rounded-md transition ${range === r ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {data && !loading && (
        <>
          {/* Cards de totais */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-xs text-gray-500">OS criadas</div>
              <div className="text-2xl font-semibold text-gray-900 mt-1">{data.totals.os_count}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-xs text-gray-500">OS aprovadas</div>
              <div className="text-2xl font-semibold text-emerald-600 mt-1">{data.totals.approved_count}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {data.totals.os_count > 0 ? fmtPct(data.totals.approved_count / data.totals.os_count) : '—'} aprovaram
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-xs text-gray-500">Receita aprovada</div>
              <div className="text-2xl font-semibold text-emerald-700 mt-1">{fmtBRL(data.totals.approved_revenue_cents)}</div>
              <div className="text-xs text-gray-400 mt-0.5">Total faturado: {fmtBRL(data.totals.total_revenue_cents)}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-xs text-gray-500">Cobertura tracking</div>
              <div className="text-2xl font-semibold text-gray-900 mt-1">{data.coverage_pct.toFixed(1)}%</div>
              <div className="text-xs text-gray-400 mt-0.5">{data.totals.tracked_count} de {data.totals.os_count} OS</div>
            </div>
          </div>

          {/* Aviso CWT recente */}
          {data.coverage_pct < 30 && data.totals.os_count > 5 && (
            <div className="mb-4 p-3 rounded-md bg-amber-50 border border-amber-200 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <p className="font-medium">Cobertura de tracking baixa ({data.coverage_pct.toFixed(1)}%)</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  A tag CWT (Click-to-WhatsApp Tracking) foi ativa em 2026-05-21. OS criadas antes não têm tracking de canal.
                  Dados pós-21/05 vão acumular cobertura de ~70-90%.
                </p>
              </div>
            </div>
          )}

          {/* Funil GA4 → ERP */}
          {ga4 && (() => {
            const funnel = buildFunnel()
            const hasAny = funnel.some(f => f.clicks_whatsapp > 0 || f.os_count > 0)
            if (!hasAny) return null
            return (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <h2 className="text-base font-semibold text-gray-900 mb-1">Funil: cliques WhatsApp → OS → aprovadas</h2>
                <p className="text-xs text-gray-500 mb-3">
                  Cliques de GA4 (janela {range === '7d' ? '7 dias' : '30 dias'}) × OS no ERP no período selecionado.
                  Comparação aproximada — janelas podem diferir.
                </p>
                <div className="space-y-2">
                  {funnel.map(f => {
                    const conv1 = f.clicks_whatsapp > 0 ? (f.os_count / f.clicks_whatsapp * 100) : null
                    const conv2 = f.os_count > 0 ? (f.approved_count / f.os_count * 100) : null
                    return (
                      <div key={f.channel} className="flex items-center gap-1 sm:gap-2 text-sm">
                        <div className="w-32 sm:w-36 flex items-center gap-1.5">
                          <span>{f.emoji}</span>
                          <span className="font-medium text-gray-900 truncate">{f.label}</span>
                        </div>
                        <div className="flex-1 flex items-center gap-1 sm:gap-2 overflow-x-auto">
                          <div className="bg-blue-50 text-blue-900 px-2 py-1 rounded text-xs whitespace-nowrap font-mono">
                            {f.clicks_whatsapp} clicks
                          </div>
                          <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <div className="bg-gray-50 text-gray-900 px-2 py-1 rounded text-xs whitespace-nowrap font-mono">
                            {f.os_count} OS
                            {conv1 !== null && (
                              <span className="ml-1 text-gray-500">({conv1.toFixed(0)}%)</span>
                            )}
                          </div>
                          <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <div className="bg-emerald-50 text-emerald-900 px-2 py-1 rounded text-xs whitespace-nowrap font-mono">
                            {f.approved_count} aprov
                            {conv2 !== null && (
                              <span className="ml-1 text-emerald-600">({conv2.toFixed(0)}%)</span>
                            )}
                          </div>
                          <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <div className="bg-emerald-100 text-emerald-900 px-2 py-1 rounded text-xs whitespace-nowrap font-mono font-semibold">
                            {f.approved_revenue_cents > 0 ? fmtBRL(f.approved_revenue_cents) : 'R$ 0'}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  ⓘ As <code>%</code> mostram conversão estagio→estagio. Conv1 = OS/clicks · Conv2 = aprovadas/OS. Alta conv1 com baixa conv2 = anúncio gera lead mas orçamento perde no fechamento.
                </p>
              </div>
            )
          })()}

          {/* Chart evolução diária */}
          {data.timeline && data.timeline.length > 0 && (() => {
            // Quais canais tem ao menos 1 dia com valor > 0?
            const activeChannels = (Object.keys(CHART_COLORS) as Array<keyof typeof CHART_COLORS>).filter(ch =>
              data.timeline.some(d => ((d as any)[ch] || 0) > 0)
            )
            if (activeChannels.length === 0) return null
            return (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <h2 className="text-base font-semibold text-gray-900 mb-1">Evolução diária — OS criadas por canal</h2>
                <p className="text-xs text-gray-500 mb-3">Mostra tendência. Canal flat = anúncio parado ou tracking não capturando.</p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.timeline} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: '#6b7280' }}
                        tickFormatter={d => d.slice(5)}
                      />
                      <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 6 }}
                        labelFormatter={(d: string) => new Date(d).toLocaleDateString('pt-BR')}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {activeChannels.map(ch => (
                        <Line
                          key={ch}
                          type="monotone"
                          dataKey={ch}
                          stroke={CHART_COLORS[ch]}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          name={data.breakdown.find(b => b.channel === ch)?.label || ch}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )
          })()}

          {/* Tabela */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-700">Canal</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-700">OS</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-700">% OS</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-700">Aprovadas</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-700">Tx aprovação</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-700">Receita aprovada</th>
                    {/* Sprint UX-16: CAC + ROI por canal */}
                    <th className="text-right px-4 py-3 font-medium text-gray-700" title="Investimento mensal — clique pra editar">Invest.</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-700" title="CAC = investimento / aprovadas">CAC</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-700" title="ROI = (receita - investimento) / investimento">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.map(b => {
                    const pctOs = data.totals.os_count > 0 ? (b.os_count / data.totals.os_count) * 100 : 0
                    const isOpen = expanded.has(b.channel)
                    const hasOrders = b.top_orders.length > 0
                    return (
                      <Fragment key={b.channel}>
                        <tr
                          className={`border-b border-gray-100 hover:bg-gray-50 ${hasOrders ? 'cursor-pointer' : ''}`}
                          onClick={() => hasOrders && toggleExpand(b.channel)}
                        >
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-2 font-medium text-gray-900">
                              {hasOrders ? (
                                isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />
                              ) : <span className="w-4 h-4 inline-block" />}
                              <span>{b.emoji}</span>
                              {b.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-gray-900">{b.os_count}</td>
                          <td className="px-4 py-3 text-right text-gray-500 text-xs">{pctOs.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-right">
                            {b.approved_count > 0 ? (
                              <span className="inline-flex items-center gap-1 font-mono text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {b.approved_count}
                              </span>
                            ) : (
                              <span className="text-gray-400">0</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-xs">
                            {b.os_count > 0 ? (
                              <span className={b.approval_rate >= 0.3 ? 'text-emerald-600 font-medium' : b.approval_rate >= 0.15 ? 'text-amber-600' : 'text-gray-500'}>
                                {fmtPct(b.approval_rate)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-emerald-700">{b.approved_revenue_cents > 0 ? fmtBRL(b.approved_revenue_cents) : '—'}</td>
                          {/* Investimento manual (clique pra editar) */}
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); editInvestment(b.channel, b.investment_cents || 0) }}
                              className="text-xs font-mono text-gray-600 hover:text-blue-600 underline decoration-dotted"
                              title="Clique pra editar investimento mensal"
                            >
                              {b.investment_cents && b.investment_cents > 0 ? fmtBRL(b.investment_cents) : '— set'}
                            </button>
                          </td>
                          {/* CAC */}
                          <td className="px-4 py-3 text-right text-xs">
                            {b.cac_cents != null ? (
                              <span className={b.cac_cents <= 50000 ? 'text-emerald-700 font-medium' : b.cac_cents <= 150000 ? 'text-amber-600' : 'text-red-600 font-medium'}>
                                {fmtBRL(b.cac_cents)}
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          {/* ROI */}
                          <td className="px-4 py-3 text-right text-xs">
                            {b.roi_pct != null ? (
                              <span className={b.roi_pct >= 100 ? 'text-emerald-700 font-medium' : b.roi_pct >= 0 ? 'text-amber-600' : 'text-red-600 font-medium'}>
                                {b.roi_pct > 0 ? '+' : ''}{b.roi_pct}%
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                        {isOpen && hasOrders && (
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <td colSpan={9} className="px-4 py-3">
                              <div className="text-xs text-gray-500 mb-2 font-medium">
                                Top {b.top_orders.length} OS de {b.label} (ordenadas por valor aprovado)
                              </div>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-gray-500 border-b border-gray-200">
                                    <th className="py-1.5 font-medium">OS</th>
                                    <th className="py-1.5 font-medium">Cliente</th>
                                    <th className="py-1.5 font-medium">Criada em</th>
                                    <th className="py-1.5 font-medium text-right">Valor aprovado</th>
                                    <th className="py-1.5 font-medium text-right">Total</th>
                                    <th className="py-1.5 font-medium text-right">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {b.top_orders.map(o => (
                                    <tr key={o.os_id} className="border-b border-gray-100 last:border-0">
                                      <td className="py-1.5">
                                        <Link
                                          href={`/os/${o.os_id}`}
                                          className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 font-mono"
                                        >
                                          #{o.os_number}
                                          <ExternalLink className="w-3 h-3" />
                                        </Link>
                                      </td>
                                      <td className="py-1.5 text-gray-700">{o.customer_name || '—'}</td>
                                      <td className="py-1.5 text-gray-500">{new Date(o.created_at).toLocaleDateString('pt-BR')}</td>
                                      <td className="py-1.5 text-right font-mono text-emerald-700">{o.approved_cost > 0 ? fmtBRL(o.approved_cost) : '—'}</td>
                                      <td className="py-1.5 text-right font-mono text-gray-600">{o.total_cost > 0 ? fmtBRL(o.total_cost) : '—'}</td>
                                      <td className="py-1.5 text-right">
                                        {o.approved ? (
                                          <span className="inline-flex items-center gap-1 text-emerald-600">
                                            <CheckCircle2 className="w-3 h-3" /> Aprovada
                                          </span>
                                        ) : (
                                          <span className="text-gray-400">—</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 text-xs text-gray-400">
            Tracking via gclid (Google Ads), msclkid (Microsoft Ads), utm_source/utm_medium (CWT tag desde 2026-05-21).
            &quot;Aprovada&quot; = service_orders.approved_cost &gt; 0. &quot;Receita aprovada&quot; soma approved_cost da OS no canal.
          </div>

          {/* Email engagement (quem chamou pelo email) */}
          {email && (
            <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                    <Mail className="w-5 h-5 text-purple-600" />
                    Quem chamou pelo email
                  </h2>
                  <p className="text-xs text-gray-500">Contatos que abriram ou clicaram em link de campanha Mautic/Resend</p>
                </div>
                <div className="inline-flex rounded-lg border border-gray-200 p-1">
                  {(['24h', '7d', '30d'] as const).map(w => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setEmailWindow(w)}
                      className={`px-2 py-1 text-xs rounded transition ${emailWindow === w ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-gray-50 rounded p-2">
                  <div className="text-xs text-gray-500">Total ativos</div>
                  <div className="text-lg font-semibold text-gray-900">{email.counts.total}</div>
                </div>
                <div className="bg-blue-50 rounded p-2">
                  <div className="text-xs text-blue-600">Clicaram</div>
                  <div className="text-lg font-semibold text-blue-900">{email.counts.clicked}</div>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <div className="text-xs text-gray-500">Só abriram</div>
                  <div className="text-lg font-semibold text-gray-900">{email.counts.opened_only}</div>
                </div>
              </div>

              {email.items.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-6">
                  Nenhuma atividade de email registrada nas últimas {emailWindow}.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                        <th className="py-2 font-medium">Contato</th>
                        <th className="py-2 font-medium">Email</th>
                        <th className="py-2 font-medium">Telefone</th>
                        <th className="py-2 font-medium">Ação</th>
                        <th className="py-2 font-medium">Quando</th>
                      </tr>
                    </thead>
                    <tbody>
                      {email.items.map(it => {
                        const ts = it.last_clicked_at || it.last_opened_at
                        return (
                          <tr key={it.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                            <td className="py-2">
                              {it.customer_id ? (
                                <Link href={`/clientes/${it.customer_id}`} className="text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1">
                                  {it.name}
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              ) : (
                                <span className="text-gray-900 font-medium">{it.name}</span>
                              )}
                            </td>
                            <td className="py-2 text-gray-600 text-xs">{it.email}</td>
                            <td className="py-2 text-gray-600 text-xs">{it.phone || '—'}</td>
                            <td className="py-2">
                              {it.action === 'clicked' ? (
                                <span className="inline-flex items-center gap-1 text-blue-700 text-xs">
                                  <MousePointerClick className="w-3.5 h-3.5" /> clicou
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-gray-600 text-xs">
                                  <Mail className="w-3.5 h-3.5" /> abriu
                                </span>
                              )}
                            </td>
                            <td className="py-2 text-gray-500 text-xs">
                              {ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
