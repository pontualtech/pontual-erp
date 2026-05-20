'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, MailX, AlertTriangle, Zap, Send, ArrowLeft, Loader2, TrendingDown,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { StatCard } from '@/components/marketing/StatCard'
import { formatNumber } from '@/lib/marketing/format'

type Range = '7d' | '30d' | '90d'

interface OverviewKpis {
  totalContacts: number
  unsubCount: number
  unsubRate: number
  bouncedCount: number
  bounceRate: number
  automationsActive: number
  campaignsLastRange: number
  automationRunsLastRange: number
}

interface FunnelItem { key: string; label: string; color: string; count: number; pctOfTotal: number }
interface TagItem { tag: string; count: number }
interface TimelineItem { date: string; success: number; failed: number; skipped: number; total: number }
interface CampaignItem {
  campaign: string
  sent: number; delivered: number; opened: number; clicked: number; bounced: number
  rates: { delivery: number; open: number; click: number; bounce: number }
  last_at: string
}

const RANGE_LABELS: Record<Range, string> = { '7d': '7 dias', '30d': '30 dias', '90d': '90 dias' }

// Cores acessíveis (Tailwind palette - todas passam WCAG sobre branco)
const STAGE_COLORS: Record<string, string> = {
  lead_aguardando: '#3b82f6',      // blue-500
  em_negociacao: '#8b5cf6',        // violet-500
  cliente_em_servico: '#f59e0b',   // amber-500
  cliente_atendido: '#10b981',     // emerald-500
  perdido_recusou: '#ef4444',      // red-500
}

const CAMPAIGN_DONUT_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444']

export default function MarketingDashboardPage() {
  const [range, setRange] = useState<Range>('30d')
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<OverviewKpis | null>(null)
  const [funnel, setFunnel] = useState<FunnelItem[]>([])
  const [tags, setTags] = useState<TagItem[]>([])
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      fetch(`/api/marketing/metrics/overview?range=${range}`).then(r => r.ok ? r.json() : Promise.reject(r)),
      fetch('/api/marketing/metrics/funnel').then(r => r.ok ? r.json() : Promise.reject(r)),
      fetch('/api/marketing/metrics/tags?limit=10').then(r => r.ok ? r.json() : Promise.reject(r)),
      fetch(`/api/marketing/metrics/timeline?range=${range}`).then(r => r.ok ? r.json() : Promise.reject(r)),
      fetch('/api/marketing/campanhas').then(r => r.ok ? r.json() : Promise.reject(r)),
    ])
      .then(([ov, fu, tg, tl, cp]) => {
        if (cancelled) return
        setKpis(ov.data?.kpis ?? ov.kpis ?? null)
        setFunnel(fu.data?.funnel ?? fu.funnel ?? [])
        setTags(tg.data?.tags ?? tg.tags ?? [])
        setTimeline(tl.data?.timeline ?? tl.timeline ?? [])
        const allCamps = cp.data?.campaigns ?? cp.campaigns ?? []
        setCampaigns(allCamps.filter((c: CampaignItem) => c.campaign !== '(sem campaign)').slice(0, 5))
      })
      .catch(async err => {
        if (cancelled) return
        const msg = err?.statusText || (await err?.text?.().catch(() => null)) || 'Erro ao carregar métricas'
        setError(typeof msg === 'string' ? msg : 'Erro ao carregar métricas')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [range])

  return (
    <div className="space-y-6">
      {/* Header com back + range selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/marketing"
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Marketing
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Dashboard de Métricas
          </h1>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
          {(['7d', '30d', '90d'] as Range[]).map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={[
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer',
                range === r
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              ].join(' ')}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 p-4 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* KPI Cards (5) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          icon={Users}
          label="Total de contatos"
          value={loading ? '…' : (kpis?.totalContacts ?? 0)}
          tone="blue"
          href="/marketing/contatos"
        />
        <StatCard
          icon={MailX}
          label="Descadastrados"
          value={loading ? '…' : (kpis?.unsubCount ?? 0)}
          hint={kpis ? `${(kpis.unsubRate * 100).toFixed(1)}% da base` : undefined}
          tone="rose"
        />
        <StatCard
          icon={AlertTriangle}
          label="Com bounce"
          value={loading ? '…' : (kpis?.bouncedCount ?? 0)}
          hint={kpis ? `${(kpis.bounceRate * 100).toFixed(1)}% da base` : undefined}
          tone="amber"
        />
        <StatCard
          icon={Zap}
          label="Automações ativas"
          value={loading ? '…' : (kpis?.automationsActive ?? 0)}
          hint={kpis ? `${formatNumber(kpis.automationRunsLastRange)} runs em ${RANGE_LABELS[range]}` : undefined}
          tone="green"
          href="/marketing/automations"
        />
        <StatCard
          icon={Send}
          label={`Envios em ${RANGE_LABELS[range]}`}
          value={loading ? '…' : (kpis?.campaignsLastRange ?? 0)}
          tone="default"
          href="/marketing/campanhas"
        />
      </div>

      {/* Funnel + Top Tags (2 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Funnel */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Funil de contatos
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
            Distribuição por estágio do pipeline
          </p>
          {loading ? (
            <div className="flex items-center justify-center h-64 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : funnel.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-sm text-slate-500">
              Sem contatos com tags de estágio.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={funnel} layout="vertical" margin={{ left: 12, right: 20, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-slate-200 dark:stroke-slate-800" />
                <XAxis type="number" tickFormatter={(v) => formatNumber(v)} className="text-xs" />
                <YAxis type="category" dataKey="label" width={140} className="text-xs" />
                <Tooltip
                  formatter={(value: number) => [formatNumber(value), 'Contatos']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {funnel.map((entry, i) => (
                    <Cell key={i} fill={STAGE_COLORS[entry.key] || '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Tags */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Top 10 tags
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
            Excluindo prefixos técnicos (stage/segment/year)
          </p>
          {loading ? (
            <div className="flex items-center justify-center h-64 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : tags.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-sm text-slate-500">
              Sem tags personalizadas.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={tags} layout="vertical" margin={{ left: 12, right: 20, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-slate-200 dark:stroke-slate-800" />
                <XAxis type="number" tickFormatter={(v) => formatNumber(v)} className="text-xs" />
                <YAxis type="category" dataKey="tag" width={140} className="text-xs" />
                <Tooltip
                  formatter={(value: number) => [formatNumber(value), 'Contatos']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Timeline (full width) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
          Execuções de automação
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
          Runs por dia nos últimos {RANGE_LABELS[range]}
        </p>
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={timeline} margin={{ left: 0, right: 20, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" />
              <XAxis
                dataKey="date"
                className="text-xs"
                tickFormatter={(v: string) => {
                  const d = new Date(v + 'T00:00:00')
                  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                }}
                interval={Math.max(0, Math.floor(timeline.length / 10))}
              />
              <YAxis className="text-xs" allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                labelFormatter={(label: string) => new Date(label + 'T00:00:00').toLocaleDateString('pt-BR')}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="success" stroke="#10b981" strokeWidth={2} dot={false} name="Sucesso" />
              <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} dot={false} name="Falha" />
              <Line type="monotone" dataKey="skipped" stroke="#94a3b8" strokeWidth={2} dot={false} name="Skipped" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Last 5 Campaigns - cards with donut */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Últimas campanhas
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Performance dos últimos 5 envios via Resend
            </p>
          </div>
          <Link
            href="/marketing/campanhas"
            className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
          >
            Ver todas →
          </Link>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-sm text-slate-500">
            Nenhuma campanha registrada ainda.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {campaigns.map((c) => {
              const donutData = [
                { name: 'Entregue', value: Math.max(0, c.delivered - c.opened) },
                { name: 'Aberto', value: Math.max(0, c.opened - c.clicked) },
                { name: 'Clicou', value: c.clicked },
                { name: 'Bounce', value: c.bounced },
              ].filter(d => d.value > 0)

              return (
                <div key={c.campaign} className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate" title={c.campaign}>
                        {c.campaign}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatNumber(c.sent)} enviados · {new Date(c.last_at).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <ResponsiveContainer width={88} height={88}>
                      <PieChart>
                        <Pie
                          data={donutData}
                          dataKey="value"
                          innerRadius={26}
                          outerRadius={42}
                          stroke="none"
                        >
                          {donutData.map((_, i) => (
                            <Cell key={i} fill={CAMPAIGN_DONUT_COLORS[i % CAMPAIGN_DONUT_COLORS.length]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 text-xs space-y-1">
                      <Row label="Delivery" value={`${c.rates.delivery}%`} color="text-emerald-600 dark:text-emerald-400" />
                      <Row label="Open" value={`${c.rates.open}%`} color="text-blue-600 dark:text-blue-400" />
                      <Row label="Click" value={`${c.rates.click}%`} color="text-violet-600 dark:text-violet-400" />
                      <Row label="Bounce" value={`${c.rates.bounce}%`} color="text-rose-600 dark:text-rose-400" />
                    </div>
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

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`font-medium ${color}`}>{value}</span>
    </div>
  )
}
