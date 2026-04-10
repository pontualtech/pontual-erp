'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Loader2, Wrench, CheckCircle, Clock, AlertTriangle, Timer, TrendingUp,
  Zap, ShieldAlert, CalendarClock, Monitor, ArrowRight, Trophy, Target, Flame
} from 'lucide-react'

interface Cards {
  em_andamento: number; completadas_hoje: number; completadas_semana: number
  completadas_mes: number; taxa_garantia: number; garantias_mes: number
}
interface Prazo { atrasadas: number; vencendo_hoje: number; no_prazo: number; sem_prazo: number }
interface Performance { avg_repair_hours: number; avg_repair_days: number }
interface FilaItem {
  id: string; os_number: number; priority: string; equipment: string; customer: string
  reported_issue: string; status: string; status_color: string
  estimated_delivery: string | null; total_cost: number; prazo_status: string; created_at: string
}
interface PipelineItem { name: string; color: string; count: number }
interface EquipItem { type: string; count: number }
interface RecentItem { id: string; os_number: number; equipment: string; customer: string; total_cost: number; completed_at: string }

function fmt(cents: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100) }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '--' }
function fmtDateTime(d: string) { return d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--' }

const prioConfig: Record<string, { label: string; color: string; icon: typeof Flame }> = {
  URGENT: { label: 'Urgente', color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950', icon: Flame },
  HIGH: { label: 'Alta', color: 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950', icon: AlertTriangle },
  MEDIUM: { label: 'Media', color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950', icon: Target },
  LOW: { label: 'Baixa', color: 'text-gray-600 bg-gray-50 dark:text-gray-400 dark:bg-gray-800', icon: Clock },
}

export default function TecnicoDashboard() {
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<Cards | null>(null)
  const [prazo, setPrazo] = useState<Prazo | null>(null)
  const [perf, setPerf] = useState<Performance | null>(null)
  const [fila, setFila] = useState<FilaItem[]>([])
  const [pipeline, setPipeline] = useState<PipelineItem[]>([])
  const [topEquip, setTopEquip] = useState<EquipItem[]>([])
  const [recent, setRecent] = useState<RecentItem[]>([])

  // Admin: seletor de técnico
  const [tecnicos, setTecnicos] = useState<{ id: string; name: string }[]>([])
  const [selectedTech, setSelectedTech] = useState('')
  const [techName, setTechName] = useState('')

  function loadDashboard(techId?: string) {
    setLoading(true)
    const params = techId ? `?tech_id=${techId}` : ''
    fetch(`/api/dashboard/tecnico${params}`)
      .then(r => r.json())
      .then(d => {
        if (!d.data) { toast.error('Sem dados'); return }
        setCards(d.data.cards); setPrazo(d.data.prazo); setPerf(d.data.performance)
        setFila(d.data.fila_trabalho); setPipeline(d.data.pipeline)
        setTopEquip(d.data.top_equipamentos); setRecent(d.data.recent_completed)
      })
      .catch(() => toast.error('Erro ao carregar dashboard'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadDashboard()
    // Load technician list for admin selector
    fetch('/api/users?simple=true').then(r => r.json())
      .then(d => setTecnicos(d.data ?? []))
      .catch(() => {})
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-20 gap-2 text-gray-400 dark:text-gray-500">
      <Loader2 className="h-5 w-5 animate-spin" /> Carregando dashboard...
    </div>
  )

  const totalPrazo = (prazo?.atrasadas || 0) + (prazo?.vencendo_hoje || 0) + (prazo?.no_prazo || 0) + (prazo?.sem_prazo || 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Wrench className="h-6 w-6 text-blue-600" /> {techName ? `Painel — ${techName}` : 'Meu Painel'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">OS, prazos e performance</p>
        </div>
        {/* Admin: seletor de técnico */}
        {tecnicos.length > 1 && (
          <select title="Ver painel de outro tecnico" value={selectedTech}
            onChange={e => {
              const tid = e.target.value
              setSelectedTech(tid)
              const tech = tecnicos.find(t => t.id === tid)
              setTechName(tech?.name || '')
              loadDashboard(tid || undefined)
            }}
            className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
            <option value="">Meu Painel</option>
            {tecnicos.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {/* ─── KPI Cards ────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={Wrench} label="Em Andamento" value={cards?.em_andamento ?? 0} color="text-blue-600 dark:text-blue-400" bg="bg-blue-50 dark:bg-blue-950" />
        <KpiCard icon={CheckCircle} label="Hoje" value={cards?.completadas_hoje ?? 0} color="text-green-600 dark:text-green-400" bg="bg-green-50 dark:bg-green-950" />
        <KpiCard icon={TrendingUp} label="Semana" value={cards?.completadas_semana ?? 0} color="text-indigo-600 dark:text-indigo-400" bg="bg-indigo-50 dark:bg-indigo-950" />
        <KpiCard icon={Trophy} label="Mes" value={cards?.completadas_mes ?? 0} color="text-purple-600 dark:text-purple-400" bg="bg-purple-50 dark:bg-purple-950" />
        <KpiCard icon={Timer} label="Tempo Medio" value={`${perf?.avg_repair_days?.toFixed(1) ?? '—'}d`} color="text-amber-600 dark:text-amber-400" bg="bg-amber-50 dark:bg-amber-950" />
        <KpiCard icon={ShieldAlert} label="Garantia" value={`${cards?.taxa_garantia ?? 0}%`} color={Number(cards?.taxa_garantia) > 10 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'} bg={Number(cards?.taxa_garantia) > 10 ? 'bg-red-50 dark:bg-red-950' : 'bg-green-50 dark:bg-green-950'} />
      </div>

      {/* ─── Prazo + Pipeline ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Prazo */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            <CalendarClock className="h-4 w-4" /> Controle de Prazo
          </h2>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <PrazoCard label="Atrasadas" count={prazo?.atrasadas ?? 0} color="text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800" />
            <PrazoCard label="Vence Hoje" count={prazo?.vencendo_hoje ?? 0} color="text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800" />
            <PrazoCard label="No Prazo" count={prazo?.no_prazo ?? 0} color="text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800" />
            <PrazoCard label="Sem Prazo" count={prazo?.sem_prazo ?? 0} color="text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700" />
          </div>
          {/* Bar visual */}
          {totalPrazo > 0 && (
            <div className="h-3 rounded-full overflow-hidden flex bg-gray-100 dark:bg-gray-800">
              {(prazo?.atrasadas ?? 0) > 0 && <div className="bg-red-500 h-full" style={{ width: `${((prazo?.atrasadas ?? 0) / totalPrazo) * 100}%` }} />}
              {(prazo?.vencendo_hoje ?? 0) > 0 && <div className="bg-amber-500 h-full" style={{ width: `${((prazo?.vencendo_hoje ?? 0) / totalPrazo) * 100}%` }} />}
              {(prazo?.no_prazo ?? 0) > 0 && <div className="bg-green-500 h-full" style={{ width: `${((prazo?.no_prazo ?? 0) / totalPrazo) * 100}%` }} />}
              {(prazo?.sem_prazo ?? 0) > 0 && <div className="bg-gray-300 dark:bg-gray-600 h-full" style={{ width: `${((prazo?.sem_prazo ?? 0) / totalPrazo) * 100}%` }} />}
            </div>
          )}
        </div>

        {/* Pipeline por Status */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            <Zap className="h-4 w-4" /> Minhas OS por Status
          </h2>
          {pipeline.length > 0 ? (
            <div className="space-y-2">
              {pipeline.map(p => {
                const maxCount = Math.max(...pipeline.map(x => x.count))
                return (
                  <div key={p.name} className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="text-sm text-gray-700 dark:text-gray-300 w-32 truncate">{p.name}</span>
                    <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full flex items-center justify-end px-2 text-[10px] font-bold text-white min-w-[24px]"
                        style={{ backgroundColor: p.color, width: `${Math.max((p.count / maxCount) * 100, 10)}%` }}>
                        {p.count}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <p className="text-sm text-gray-400">Nenhuma OS pendente</p>}
        </div>
      </div>

      {/* ─── Fila de Trabalho ─────────────────── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            <Wrench className="h-4 w-4" /> Fila de Trabalho ({fila.length})
          </h2>
          <Link href="/os" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
            Ver todas <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {fila.length > 0 ? (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {fila.map(item => {
              const prio = prioConfig[item.priority] || prioConfig.MEDIUM
              const PrioIcon = prio.icon
              return (
                <Link key={item.id} href={`/os/${item.id}`}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  {/* Prazo indicator */}
                  <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0',
                    item.prazo_status === 'atrasada' ? 'bg-red-100 dark:bg-red-950' :
                    item.prazo_status === 'hoje' ? 'bg-amber-100 dark:bg-amber-950' :
                    item.prazo_status === 'no_prazo' ? 'bg-green-100 dark:bg-green-950' : 'bg-gray-100 dark:bg-gray-800'
                  )}>
                    {item.prazo_status === 'atrasada' ? <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" /> :
                     item.prazo_status === 'hoje' ? <Flame className="h-5 w-5 text-amber-600 dark:text-amber-400" /> :
                     <Clock className="h-5 w-5 text-gray-500 dark:text-gray-400" />}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-white text-sm">OS-{String(item.os_number).padStart(4, '0')}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: item.status_color }}>{item.status}</span>
                      <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium flex items-center gap-0.5', prio.color)}>
                        <PrioIcon className="h-2.5 w-2.5" /> {prio.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{item.equipment} — {item.customer}</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{item.reported_issue}</p>
                  </div>

                  {/* Prazo */}
                  <div className="text-right flex-shrink-0">
                    {item.estimated_delivery ? (
                      <span className={cn('text-xs font-medium',
                        item.prazo_status === 'atrasada' ? 'text-red-600 dark:text-red-400' :
                        item.prazo_status === 'hoje' ? 'text-amber-600 dark:text-amber-400' :
                        'text-gray-600 dark:text-gray-400'
                      )}>
                        {item.prazo_status === 'atrasada' ? 'ATRASADA' : item.prazo_status === 'hoje' ? 'VENCE HOJE' : fmtDate(item.estimated_delivery)}
                      </span>
                    ) : <span className="text-xs text-gray-300 dark:text-gray-600">Sem prazo</span>}
                    {item.total_cost > 0 && <p className="text-xs text-gray-400 mt-0.5">{fmt(item.total_cost)}</p>}
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="px-5 py-12 text-center">
            <CheckCircle className="h-8 w-8 text-green-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Parabens! Nenhuma OS pendente.</p>
          </div>
        )}
      </div>

      {/* ─── Bottom grid: Equipamentos + Recentes ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Equipamentos */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            <Monitor className="h-4 w-4" /> Equipamentos Mais Reparados
          </h2>
          {topEquip.length > 0 ? (
            <div className="space-y-2">
              {topEquip.map((eq, i) => (
                <div key={eq.type} className="flex items-center gap-3">
                  <span className={cn('h-6 w-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white',
                    i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-amber-700' : 'bg-gray-300 dark:bg-gray-600'
                  )}>{i + 1}</span>
                  <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{eq.type}</span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{eq.count}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400">Sem dados</p>}
        </div>

        {/* Últimas Completadas */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            <CheckCircle className="h-4 w-4" /> Ultimas Completadas
          </h2>
          {recent.length > 0 ? (
            <div className="space-y-3">
              {recent.map(r => (
                <Link key={r.id} href={`/os/${r.id}`} className="flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg p-2 -mx-2 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">OS-{String(r.os_number).padStart(4, '0')} — {r.equipment}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{r.customer} · {fmtDateTime(r.completed_at)}</p>
                  </div>
                  {r.total_cost > 0 && <span className="text-sm font-semibold text-green-600 dark:text-green-400">{fmt(r.total_cost)}</span>}
                </Link>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400">Nenhuma OS completada recentemente</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────
function KpiCard({ icon: Icon, label, value, color, bg }: { icon: any; label: string; value: string | number; color: string; bg: string }) {
  return (
    <div className={cn('rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm', bg)}>
      <Icon className={cn('h-5 w-5 mb-2', color)} />
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  )
}

function PrazoCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className={cn('rounded-xl border p-3 text-center', color)}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-[10px] font-medium uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  )
}
