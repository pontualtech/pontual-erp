'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Users, Activity, TrendingUp, Target, Mail, Smartphone, Monitor } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { toast } from 'sonner'

interface RecentJourney {
  id: string
  contact_email: string
  contact_name: string | null
  journey_type: string
  current_step: number
  started_at: string
  last_step_at: string | null
  ended_at: string | null
  outcome: string | null
  equipments_interest: string[]
}

interface CohortRow {
  cohort_month: string
  captured: number
  reactivated_30d: number
  reactivated_60d: number
  reactivated_90d: number
  rate_30d: number
  rate_60d: number
  rate_90d: number
}

interface InterestRow {
  interest: string
  count: number
  reactivated_count: number
  rate: number
}

interface NurtureStats {
  kpis: {
    total: number
    active: number
    ended: number
    reactivated: number
    unsubscribed: number
    bounced: number
    engaged: number
    conversion_rate: number
    engagement_rate: number
  }
  funnel: {
    capturados: number
    engajaram: number
    ativos: number
    reativados: number
  }
  cohort: CohortRow[]
  by_interest: InterestRow[]
  recent: RecentJourney[]
}

const OUTCOME_BADGE: Record<string, string> = {
  reactivated: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  unsubscribed: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bounced: 'bg-red-500/15 text-red-300 border-red-500/30',
  completed: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
}

export default function NurtureDashboardPage() {
  const [data, setData] = useState<NurtureStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/marketing/nurture/stats')
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json()
        if (json.data) setData(json.data)
        else throw new Error(json.error || 'Resposta sem data')
      })
      .catch(err => {
        toast.error('Falha ao carregar métricas: ' + (err?.message || 'erro desconhecido'))
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center text-gray-500 py-20">
        <p>Sem dados ainda — nurture entra em ação quando o primeiro lead for capturado.</p>
        <Link href="/marketing" className="text-amber-400 hover:text-amber-300 text-sm mt-2 inline-block">
          ← Voltar pra marketing
        </Link>
      </div>
    )
  }

  const k = data.kpis
  const f = data.funnel

  // Calcula % no funil pra largura visual relativa
  const funnelMax = Math.max(f.capturados, 1)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/marketing" className="text-xs text-gray-500 hover:text-gray-400 inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Marketing
          </Link>
          <h1 className="text-2xl font-bold text-gray-100 mt-1">Nurture — Leads pós-recusa</h1>
          <p className="text-sm text-gray-500">
            Sequência perpétua de email + WhatsApp pra clientes que não fecharam OS.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Capturados" value={k.total} icon={Users} color="text-amber-400 bg-amber-400/10" />
        <KpiCard label="Ativos" value={k.active} icon={Activity} color="text-cyan-400 bg-cyan-400/10" />
        <KpiCard label="Reativados (voltaram)" value={k.reactivated} icon={Target} color="text-emerald-400 bg-emerald-400/10" />
        <KpiCard label="Taxa conversão" value={`${k.conversion_rate}%`} icon={TrendingUp} color="text-purple-400 bg-purple-400/10" />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SmallKpi label="Engajados" value={`${k.engaged} (${k.engagement_rate}%)`} />
        <SmallKpi label="Encerrados" value={k.ended} />
        <SmallKpi label="Descadastrados" value={k.unsubscribed} />
        <SmallKpi label="Bounced" value={k.bounced} />
      </div>

      {/* Funil */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Funil de conversão</h2>
        <div className="space-y-3">
          {[
            { label: 'Capturados', value: f.capturados, color: 'from-amber-500 to-amber-600' },
            { label: 'Engajaram (1+ touch)', value: f.engajaram, color: 'from-cyan-500 to-cyan-600' },
            { label: 'Ainda ativos', value: f.ativos, color: 'from-blue-500 to-blue-600' },
            { label: 'Reativados', value: f.reativados, color: 'from-emerald-500 to-emerald-600' },
          ].map(b => {
            const pct = (b.value / funnelMax) * 100
            return (
              <div key={b.label}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400">{b.label}</span>
                  <span className="text-gray-300 font-mono">{b.value.toLocaleString('pt-BR')}</span>
                </div>
                <div className="h-8 bg-gray-800 rounded-md overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${b.color} transition-all`}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Cohort + Interest lado-a-lado */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Cohort table */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Cohort de reativação por mês</h2>
          {data.cohort.length === 0 ? (
            <p className="text-center text-gray-500 py-8 text-sm">Sem dados de cohort ainda</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2 pr-2">Mês</th>
                    <th className="py-2 pr-2 text-right">Capt.</th>
                    <th className="py-2 pr-2 text-right">30d</th>
                    <th className="py-2 pr-2 text-right">60d</th>
                    <th className="py-2 text-right">90d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {data.cohort.map(r => (
                    <tr key={r.cohort_month} className="text-gray-300">
                      <td className="py-2 pr-2 font-mono">{r.cohort_month}</td>
                      <td className="py-2 pr-2 text-right">{r.captured}</td>
                      <td className="py-2 pr-2 text-right">
                        {r.reactivated_30d} <span className="text-gray-500">({r.rate_30d}%)</span>
                      </td>
                      <td className="py-2 pr-2 text-right">
                        {r.reactivated_60d} <span className="text-gray-500">({r.rate_60d}%)</span>
                      </td>
                      <td className="py-2 text-right">
                        {r.reactivated_90d} <span className="text-gray-500">({r.rate_90d}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Por interesse */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Por equipamento de interesse</h2>
          {data.by_interest.length === 0 ? (
            <p className="text-center text-gray-500 py-8 text-sm">Sem dados ainda</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.by_interest} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="interest" stroke="#6b7280" fontSize={11} />
                <YAxis stroke="#6b7280" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: '#9ca3af' }}
                />
                <Bar dataKey="count" fill="#06b6d4" name="Capturados" />
                <Bar dataKey="reactivated_count" fill="#10b981" name="Reativados" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recentes */}
      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-300">Últimas jornadas capturadas</h2>
        </div>
        {data.recent.length === 0 ? (
          <p className="text-center text-gray-500 py-12 text-sm">Sem jornadas ainda</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Capturado em</th>
                  <th className="px-4 py-3 text-center">Step</th>
                  <th className="px-4 py-3">Interesse</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {data.recent.map(j => (
                  <tr key={j.id} className="text-gray-300 hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-gray-200">{j.contact_name || '—'}</p>
                        <p className="text-gray-500 font-mono text-[11px]">{j.contact_email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(j.started_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400 font-mono">{j.current_step}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {j.equipments_interest.includes('printer') && (
                          <Mail className="h-3.5 w-3.5 text-cyan-400" aria-label="Impressora" />
                        )}
                        {j.equipments_interest.includes('notebook') && (
                          <Monitor className="h-3.5 w-3.5 text-purple-400" aria-label="Notebook" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {j.ended_at && j.outcome ? (
                        <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${OUTCOME_BADGE[j.outcome] || 'bg-gray-500/15 text-gray-300 border-gray-500/30'}`}>
                          {j.outcome}
                        </span>
                      ) : (
                        <span className="inline-block rounded-md border border-blue-500/30 bg-blue-500/15 text-blue-300 px-2 py-0.5 text-[11px] font-medium">
                          ativo
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: any; color: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
        <div className={`rounded-lg p-2 ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-100">
        {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
      </p>
    </div>
  )
}

function SmallKpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-900/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-base font-bold text-gray-200 mt-1">{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</p>
    </div>
  )
}
