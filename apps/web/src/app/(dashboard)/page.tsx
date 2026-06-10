'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/use-auth'
import {
  ClipboardList, Wrench, Truck, DollarSign, PackageCheck,
  Bell, Pin, Plus, X, Clock, TrendingUp, Target,
  ArrowRight, Loader2, Settings, Eye, EyeOff, AlertTriangle, User,
  Megaphone, Users as UsersIcon, BarChart3, FileText,
  Crown, Activity, Lightbulb,
} from 'lucide-react'
import { toast } from 'sonner'
import { VoipDashboardCard } from '@/components/voip/VoipDashboardCard'
import { ChargesSummaryWidget } from './components/ChargesSummaryWidget'
import { cleanDescription } from '@/lib/payment-display'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'

/* ---------- Interfaces ---------- */

interface Aviso {
  id: string
  title: string
  message: string
  priority: string
  author_name: string | null
  pinned: boolean
  expires_at: string | null
  created_at: string
}

interface DashboardStats {
  cards: {
    osAbertasHoje: number
    osEmExecucao: number
    osProntas: number
    osColetar: number
    faturamentoMesCents: number
  }
  // UX-7 #1: comparativo pra delta MoM/dia-a-dia
  previous?: {
    osAbertasOntem?: number
    faturamentoMesAnteriorCents?: number
  }
  // Audit 11: IDs dos status reais por categoria — frontend usa em hrefs
  // dos cards. Antes cards apontavam pra ?status=PRONTA enum inexistente.
  statusIds?: {
    coletar: string[]
    execucao: string[]
    prontas: string[]
    finais: string[]
  }
  osPerWeek: { week: string; count: number }[]
  pipeline: { id?: string; name: string; color: string; count: number }[]
  metrics: {
    avgRepairDays: number | null
    approvalRate: number | null
    avgTicketCents: number | null
  }
  recentOs: {
    id: string
    os_number: number
    customer_name: string
    status_name: string
    status_color: string
    created_at: string
  }[]
  recentReceivable: {
    id: string
    description: string
    customer_name: string
    total_amount: number
    status: string | null
    due_date: string
  }[]
  techWorkload: {
    id: string
    name: string
    total: number
    em_execucao: number
    atrasadas: number
  }[]
  semTecnico: number
  osAtrasadas: number
}

/* ---------- Helpers ---------- */

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
}

function formatAvisoDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const receivableStatusStyle: Record<string, string> = {
  PENDENTE: 'bg-amber-100 text-amber-700',
  RECEBIDO: 'bg-green-100 text-green-700',
  PAGO: 'bg-green-100 text-green-700',
  CANCELADO: 'bg-gray-100 text-gray-500',
  VENCIDO: 'bg-red-100 text-red-700',
}

const receivableStatusLabel: Record<string, string> = {
  PENDENTE: 'Pendente',
  RECEBIDO: 'Recebido',
  PAGO: 'Pago',
  CANCELADO: 'Cancelado',
  VENCIDO: 'Vencido',
}

const priorityStyle: Record<string, string> = {
  URGENTE: 'bg-red-100 text-red-700',
  IMPORTANTE: 'bg-amber-100 text-amber-700',
  NORMAL: 'bg-blue-100 text-blue-700',
  INFO: 'bg-gray-100 text-gray-600',
}

const priorityLabel: Record<string, string> = {
  URGENTE: 'Urgente',
  IMPORTANTE: 'Importante',
  NORMAL: 'Normal',
  INFO: 'Info',
}

/* ---------- Component ---------- */

export default function DashboardPage() {
  const router = useRouter()
  const { user, isAdmin, hasPermission } = useAuth()
  const canViewDashboard = isAdmin || hasPermission('dashboard', 'view')
  const canViewFinanceiro = hasPermission('financeiro', 'view')
  // UX-8 #2: range filter (7d/30d/90d/mes-corrente). Default: mes corrente.
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'mtd'>('mtd')

  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [avisos, setAvisos] = useState<Aviso[]>([])
  // Sprint UX-16 (2026-05-23): Insights automaticos (Linear pattern)
  const [insights, setInsights] = useState<Array<{
    id: string
    severity: 'info' | 'warning' | 'critical'
    icon: string
    title: string
    description: string
    action_label?: string
    action_url?: string
  }>>([])
  const [loading, setLoading] = useState(true)
  const [showAvisoModal, setShowAvisoModal] = useState(false)
  const [avisoForm, setAvisoForm] = useState({ title: '', message: '', priority: 'NORMAL', pinned: false, expires_at: '' })

  // Dashboard customization
  const [showCustomize, setShowCustomize] = useState(false)
  const [widgetPrefs, setWidgetPrefs] = useState<Array<{ id: string; visible: boolean }>>([
    { id: 'avisos', visible: true },
    { id: 'summary_cards', visible: true },
    { id: 'marketing_card', visible: true },
    { id: 'insights', visible: true },
    { id: 'charges_summary', visible: true },
    { id: 'chart_os_week', visible: true },
    { id: 'chart_pipeline', visible: true },
    { id: 'metrics', visible: true },
    { id: 'recent_os', visible: true },
    { id: 'receivables', visible: true },
    { id: 'tech_workload', visible: true },
  ])

  const WIDGET_LABELS: Record<string, string> = {
    avisos: 'Avisos',
    summary_cards: 'Cards de Resumo',
    marketing_card: 'CRM Marketing (acesso rápido)',
    insights: 'Insights automáticos (alertas acionáveis)',
    charges_summary: 'Cobranças Asaas',
    chart_os_week: 'Gráfico OS por Semana',
    chart_pipeline: 'Pipeline de OS',
    metrics: 'Métricas (Tempo Reparo, Aprovação, Ticket)',
    recent_os: 'Últimas OS',
    receivables: 'Contas a Receber',
    tech_workload: 'Carga por Técnico',
  }

  // F18 fix 23/05: Modo CEO (toggle Operacional vs Estratégico).
  // Inspirado em Apple Health Summary + Linear Insights + Stripe Atlas.
  // Operacional: tudo visível (default). Estratégico: foco em KPIs do CEO
  // (charges_summary, marketing_card, metrics) — esconde ruído operacional
  // (recent_os, tech_workload, receivables granular).
  const [ceoMode, setCeoMode] = useState(false)
  useEffect(() => {
    try { setCeoMode(localStorage.getItem('dashboard_ceo_mode') === '1') } catch {}
  }, [])
  function toggleCeoMode() {
    const next = !ceoMode
    setCeoMode(next)
    try { localStorage.setItem('dashboard_ceo_mode', next ? '1' : '0') } catch {}
  }
  const CEO_HIDDEN = new Set(['recent_os', 'tech_workload', 'receivables'])

  const isWidgetVisible = (id: string) => {
    if (ceoMode && CEO_HIDDEN.has(id)) return false
    return widgetPrefs.find(w => w.id === id)?.visible ?? true
  }

  const toggleWidget = (id: string) => {
    setWidgetPrefs(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w))
  }

  const moveWidget = (id: string, dir: -1 | 1) => {
    setWidgetPrefs(prev => {
      const idx = prev.findIndex(w => w.id === id)
      if (idx < 0) return prev
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const copy = [...prev]
      ;[copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]]
      return copy
    })
  }

  const savePrefs = async () => {
    try {
      await fetch('/api/dashboard/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgets: widgetPrefs }),
      })
      toast.success('Dashboard personalizado salvo!')
      setShowCustomize(false)
    } catch { toast.error('Erro ao salvar') }
  }

  const loadAvisos = () => {
    fetch('/api/avisos').then(r => r.json()).then(d => setAvisos(d.data ?? [])).catch(() => {})
    fetch('/api/dashboard/insights').then(r => r.json()).then(d => setInsights(d.data?.insights ?? [])).catch(() => {})
  }

  // Redirect if no dashboard permission
  useEffect(() => {
    if (user && !canViewDashboard) {
      window.location.href = '/os'
    }
  }, [user, canViewDashboard])

  useEffect(() => {
    if (!canViewDashboard) return
    setLoading(true)
    Promise.all([
      // UX-8 #2: passa range param pro endpoint stats
      fetch(`/api/dashboard/stats?range=${dateRange}`).then(r => r.json()).then(d => setStats(d.data)).catch(() => toast.error('Erro ao carregar dashboard')),
      fetch('/api/dashboard/preferences').then(r => r.json()).then(d => {
        if (d.data?.widgets?.length) setWidgetPrefs(d.data.widgets)
      }).catch(() => {}),
    ]).finally(() => setLoading(false))
    loadAvisos()
  }, [canViewDashboard, dateRange])

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) { if (e.key === 'Escape') setShowAvisoModal(false) }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [])

  const createAviso = async () => {
    if (!avisoForm.title.trim() || !avisoForm.message.trim()) return
    await fetch('/api/avisos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: avisoForm.title,
        message: avisoForm.message,
        priority: avisoForm.priority,
        pinned: avisoForm.pinned,
        expires_at: avisoForm.expires_at || null,
      }),
    })
    setAvisoForm({ title: '', message: '', priority: 'NORMAL', pinned: false, expires_at: '' })
    setShowAvisoModal(false)
    loadAvisos()
  }

  // UX-1 #10: cards do dashboard agora levam a filtro/contexto detalhado.
  // UX-7 #1: cada card pode ter `delta` (Δ% vs período anterior).
  // UX-12 #3 + Audit 9: esconde delta se base anterior <= 9 — evita mensagem
  //   enganosa tipo "↓ 100% vs ontem" quando ontem teve só 5 OS. Audit 9
  //   detectou off-by-one: minBase=5 + `prev < 5` deixava prev=5 passar e
  //   exibia ↓100% com curr=0. Threshold 10 OS dá margem real contra ruído.
  function calcDelta(curr: number, prev: number | undefined, minBase = 10): { pct: number; up: boolean } | null {
    if (prev == null || prev === 0) return null
    if (prev < minBase) return null  // base muito baixa → delta enganoso
    const pct = Math.round(((curr - prev) / prev) * 100)
    if (Math.abs(pct) < 1) return null  // ignora variação <1% (ruído)
    return { pct: Math.abs(pct), up: pct >= 0 }
  }

  const osAbertasHoje = stats?.cards.osAbertasHoje ?? 0
  const osAbertasOntem = stats?.previous?.osAbertasOntem
  const faturamentoMes = stats?.cards.faturamentoMesCents ?? 0
  const faturamentoPrev = stats?.previous?.faturamentoMesAnteriorCents

  // Audit 11: hrefs dos cards usam IDs reais dos status retornados pelo
  // backend. Antes apontavam pra ?status=PRONTA/COLETAR/EM_EXECUCAO enum
  // que não existia — clique levava pra lista filtrada por valor inválido,
  // resultando em 0 OS quando havia 14.
  const csvOrEmpty = (ids?: string[]) => (ids && ids.length > 0 ? ids.join(',') : '')
  const hrefColetar = csvOrEmpty(stats?.statusIds?.coletar)
  const hrefExecucao = csvOrEmpty(stats?.statusIds?.execucao)
  const hrefProntas = csvOrEmpty(stats?.statusIds?.prontas)

  const cards = [
    { label: 'OS Abertas Hoje', value: osAbertasHoje, icon: ClipboardList, color: 'text-blue-600 bg-blue-50', href: '/os?period=today', delta: calcDelta(osAbertasHoje, osAbertasOntem), deltaLabel: 'vs ontem' },
    { label: 'Aguardando Coleta', value: stats?.cards.osColetar ?? 0, icon: PackageCheck, color: 'text-purple-600 bg-purple-50', href: hrefColetar ? `/os?status=${encodeURIComponent(hrefColetar)}` : '/os', delta: null, deltaLabel: '' },
    { label: 'OS em Execução', value: stats?.cards.osEmExecucao ?? 0, icon: Wrench, color: 'text-amber-600 bg-amber-50', href: hrefExecucao ? `/os?status=${encodeURIComponent(hrefExecucao)}` : '/os', delta: null, deltaLabel: '' },
    { label: 'Prontas p/ Entrega', value: stats?.cards.osProntas ?? 0, icon: Truck, color: 'text-emerald-600 bg-emerald-50', href: hrefProntas ? `/os?status=${encodeURIComponent(hrefProntas)}` : '/os', delta: null, deltaLabel: '' },
    ...(canViewFinanceiro ? [{ label: 'Faturamento do Mês', value: formatCurrency(faturamentoMes), icon: DollarSign, color: 'text-green-600 bg-green-50', href: '/financeiro/dre', delta: calcDelta(faturamentoMes, faturamentoPrev), deltaLabel: 'vs mês passado (até hoje)' }] : []),
  ]

  if (!canViewDashboard) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-2">
          {/* Quick actions: CTA primario + 2 secundarios (estilo Bling/Conta Azul) */}
          <Link
            href="/os/novo"
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
          >
            <Plus className="h-4 w-4" />
            Nova OS
          </Link>
          <Link
            href="/fiscal/emitir-nfe"
            className="hidden md:flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 hover:border-gray-300"
            title="Emitir nova NF-e"
          >
            <FileText className="h-4 w-4 text-gray-500" />
            NF-e
          </Link>
          {canViewFinanceiro && (
            <Link
              href="/financeiro/contas-receber/novo"
              className="hidden md:flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 hover:border-gray-300"
              title="Nova cobrança / conta a receber"
            >
              <DollarSign className="h-4 w-4 text-gray-500" />
              Cobrança
            </Link>
          )}
          <div className="h-6 w-px bg-gray-200" aria-hidden="true" />
          {/* UX-8 #2: range toggle */}
          <div className="inline-flex rounded-lg border bg-white shadow-sm overflow-hidden" role="tablist" aria-label="Período do dashboard">
            {([
              { k: 'mtd', l: 'Mês' },
              { k: '7d', l: '7d' },
              { k: '30d', l: '30d' },
              { k: '90d', l: '90d' },
            ] as const).map(({ k, l }) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={dateRange === k ? 'true' : 'false'}
                onClick={() => setDateRange(k)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold transition-colors min-h-[36px]',
                  dateRange === k
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                {l}
              </button>
            ))}
          </div>
          {/* F18 fix 23/05: Modo CEO toggle (icones lucide 09/06: removeu emoji 👔⚙️) */}
          <button
            type="button"
            onClick={toggleCeoMode}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm shadow-sm transition-colors',
              ceoMode
                ? 'bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            )}
            title={ceoMode ? 'Voltar para Modo Operacional' : 'Ativar Modo CEO (foco em KPIs estratégicos)'}
          >
            {ceoMode ? <Crown className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
            {ceoMode ? 'Modo CEO' : 'Modo Operacional'}
          </button>
          <button
            type="button"
            onClick={() => setShowCustomize(true)}
            className="flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-600 shadow-sm hover:bg-gray-50 transition-colors"
          >
            <Settings className="h-4 w-4" />
            Personalizar
          </button>
        </div>
      </div>

      {/* ===== Customization Modal ===== */}
      {showCustomize && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCustomize(false)}>
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Personalizar Dashboard</h2>
              <button type="button" title="Fechar" onClick={() => setShowCustomize(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5">
              <p className="mb-4 text-sm text-gray-500">Ative/desative e reordene os widgets do seu dashboard.</p>
              <div className="space-y-1">
                {widgetPrefs.map((w, idx) => (
                  <div key={w.id} className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                    w.visible ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'
                  )}>
                    <button type="button" onClick={() => toggleWidget(w.id)}
                      className={cn('shrink-0 rounded p-1', w.visible ? 'text-blue-600' : 'text-gray-400')}>
                      {w.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <span className="flex-1 text-sm font-medium text-gray-700">{WIDGET_LABELS[w.id] || w.id}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t px-5 py-4">
              <button type="button" onClick={() => setShowCustomize(false)}
                className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button type="button" onClick={savePrefs}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Avisos ===== */}
      {isWidgetVisible('avisos') && avisos.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-500" />
              Avisos ({avisos.length})
            </h2>
            <div className="flex items-center gap-2">
              <button type="button" onClick={async () => {
                await Promise.all(avisos.map(a => fetch(`/api/avisos/${a.id}/read`, { method: 'POST' })))
                toast.success('Todos marcados como lidos')
                loadAvisos()
              }}
                className="text-xs text-gray-500 hover:text-blue-600">Marcar todos como lidos</button>
              {isAdmin && (
                <>
                  <button type="button" onClick={async () => {
                    if (!confirm(`Excluir todos os ${avisos.length} avisos?`)) return
                    await Promise.all(avisos.map(a => fetch(`/api/avisos/${a.id}`, { method: 'DELETE' })))
                    toast.success('Todos os avisos excluidos')
                    loadAvisos()
                  }}
                    className="text-xs text-red-500 hover:text-red-700">Excluir todos</button>
                  <button type="button" onClick={() => setShowAvisoModal(true)}
                    className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700">
                    <Plus className="h-3 w-3" /> Novo
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="divide-y">
            {avisos.slice(0, 5).map(aviso => (
              <div key={aviso.id} className="px-5 py-3 flex items-start gap-3 group">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {aviso.pinned && <Pin className="h-3 w-3 text-amber-500" />}
                    <span className="font-medium text-gray-900">{aviso.title}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', priorityStyle[aviso.priority] || 'bg-gray-100 text-gray-600')}>
                      {priorityLabel[aviso.priority] || aviso.priority}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-gray-600 line-clamp-2">{aviso.message}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                    {aviso.author_name && <span>{aviso.author_name}</span>}
                    <span>{formatAvisoDate(aviso.created_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button type="button" title="Marcar como lido" onClick={async (e) => {
                    e.stopPropagation()
                    await fetch(`/api/avisos/${aviso.id}/read`, { method: 'POST' })
                    toast.success('Marcado como lido')
                  }} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600">
                    <Clock className="h-3.5 w-3.5" />
                  </button>
                  {isAdmin && (
                    <button type="button" title="Excluir aviso" onClick={async (e) => {
                      e.stopPropagation()
                      await fetch(`/api/avisos/${aviso.id}`, { method: 'DELETE' })
                      loadAvisos()
                      toast.success('Aviso excluido')
                    }} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {avisos.length === 0 && isAdmin && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setShowAvisoModal(true)}
            className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600">
            <Bell className="h-4 w-4" /> Criar primeiro aviso
          </button>
        </div>
      )}

      {/* ===== Aviso Modal ===== */}
      {showAvisoModal && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAvisoModal(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Novo Aviso</h3>
              <button type="button" title="Fechar" onClick={() => setShowAvisoModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <input type="text" value={avisoForm.title}
                onChange={e => setAvisoForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Titulo do aviso"
                className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              <textarea value={avisoForm.message}
                onChange={e => setAvisoForm(f => ({ ...f, message: e.target.value }))}
                placeholder="Mensagem" rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none" />
              <div className="flex flex-wrap gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Prioridade</label>
                  <select value={avisoForm.priority}
                    onChange={e => setAvisoForm(f => ({ ...f, priority: e.target.value }))}
                    title="Prioridade" className="rounded-lg border px-3 py-1.5 text-sm">
                    <option value="INFO">Info</option>
                    <option value="NORMAL">Normal</option>
                    <option value="IMPORTANTE">Importante</option>
                    <option value="URGENTE">Urgente</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Expira em</label>
                  <input type="datetime-local" value={avisoForm.expires_at}
                    onChange={e => setAvisoForm(f => ({ ...f, expires_at: e.target.value }))}
                    title="Data de expiracao" className="rounded-lg border px-3 py-1.5 text-sm" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={avisoForm.pinned}
                      onChange={e => setAvisoForm(f => ({ ...f, pinned: e.target.checked }))}
                      className="rounded border-gray-300" />
                    <span className="text-sm text-gray-700">Fixar</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={createAviso}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  Publicar
                </button>
                <button type="button" onClick={() => setShowAvisoModal(false)}
                  className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Alertas Criticos (UX-2 #6) — derivados dos dados ja carregados
           Movido pra cima 09/06: hierarquia red flags > insights > KPIs.
           Background flat (sem gradient) pra alinhar com Pipeline novo. ===== */}
      {!loading && stats && (() => {
        const alerts: { label: string; count: number; icon: typeof ClipboardList; color: string; href: string }[] = []
        // Audit 11 wave 3: ?delayed=1 não existia, /os consome ?overdue=1.
        if (stats.osAtrasadas > 0) alerts.push({ label: 'OS atrasadas', count: stats.osAtrasadas, icon: AlertTriangle, color: 'text-red-700 bg-red-50 border-red-200', href: '/os?overdue=1' })
        if (stats.semTecnico > 0) alerts.push({ label: 'OS sem técnico', count: stats.semTecnico, icon: User, color: 'text-amber-700 bg-amber-50 border-amber-200', href: '/os?no_tech=1' })
        // Audit 12: status DB nunca é setado como 'VENCIDO' (default 'PENDENTE').
        // Vencido = displayStatus calculado: PENDENTE + due_date < hoje.
        const todayStr = new Date().toISOString().slice(0, 10)
        const arVencidas = (stats.recentReceivable || []).filter(r =>
          r.status === 'PENDENTE' && r.due_date && r.due_date.slice(0, 10) < todayStr
        ).length
        if (canViewFinanceiro && arVencidas > 0) alerts.push({ label: 'Contas vencidas', count: arVencidas, icon: DollarSign, color: 'text-red-700 bg-red-50 border-red-200', href: '/financeiro/contas-receber?status=VENCIDO' })
        if (alerts.length === 0) return null
        return (
          <div className="rounded-xl border border-red-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <h2 className="font-bold text-gray-900">Atenção necessária</h2>
              <span className="text-xs text-gray-500">— {alerts.length} item{alerts.length > 1 ? 's' : ''} aguardando você</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {alerts.map(a => {
                const I = a.icon
                return (
                  <Link
                    key={a.label}
                    href={a.href}
                    className={cn('flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-gray-50', a.color)}
                  >
                    <I className="h-5 w-5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-2xl font-bold leading-none">{a.count}</p>
                      <p className="text-xs font-semibold mt-1">{a.label}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 flex-shrink-0 opacity-40" />
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ===== Insights automáticos (Sprint UX-16) — Linear/ProfitWell pattern ===== */}
      {isWidgetVisible('insights') && insights.length > 0 && (
        <div className="rounded-xl border-2 border-blue-200 dark:border-blue-900 bg-gradient-to-br from-blue-50/40 via-white to-purple-50/30 dark:from-blue-950/20 dark:via-gray-900 dark:to-purple-950/20 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Insights — pontos de atenção hoje
            </h3>
            <span className="text-[10px] text-gray-400">{insights.length} alerta(s)</span>
          </div>
          <div className="space-y-2">
            {insights.slice(0, 5).map(ins => (
              <Link
                key={ins.id}
                href={ins.action_url || '#'}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                  ins.severity === 'critical' && 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 hover:bg-red-100 dark:hover:bg-red-950/50',
                  ins.severity === 'warning' && 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 hover:bg-amber-100 dark:hover:bg-amber-950/50',
                  ins.severity === 'info' && 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 hover:bg-blue-100 dark:hover:bg-blue-950/50',
                )}
              >
                <span className="text-xl shrink-0 leading-none">{ins.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-semibold',
                    ins.severity === 'critical' && 'text-red-900 dark:text-red-100',
                    ins.severity === 'warning' && 'text-amber-900 dark:text-amber-100',
                    ins.severity === 'info' && 'text-blue-900 dark:text-blue-100',
                  )}>{ins.title}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{ins.description}</p>
                </div>
                {ins.action_label && (
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 shrink-0 flex items-center gap-1">
                    {ins.action_label} →
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ===== Summary Cards (clicaveis - UX-1 #10) ===== */}
      {isWidgetVisible('summary_cards') && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <Link
              key={card.label}
              href={card.href}
              aria-label={`${card.label}: ${card.value}. Clique para ver detalhes.`}
              className="group rounded-xl border bg-white p-5 shadow-sm hover:shadow-md hover:border-blue-300 active:scale-[0.99] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 group-hover:text-blue-600 transition-colors">{card.label}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">
                    {loading ? <Loader2 className="h-5 w-5 animate-spin text-gray-300" /> : card.value}
                  </p>
                  {/* UX-7 #1: Δ% vs período anterior */}
                  {card.delta && (
                    <p className={cn(
                      'mt-1 text-[11px] font-semibold inline-flex items-center gap-0.5',
                      card.delta.up ? 'text-emerald-600' : 'text-red-600'
                    )} title={card.deltaLabel}>
                      {card.delta.up ? '↑' : '↓'} {card.delta.pct}%
                      <span className="text-gray-400 font-normal ml-1">{card.deltaLabel}</span>
                    </p>
                  )}
                </div>
                <div className={cn('rounded-xl p-2.5 transition-transform group-hover:scale-110', card.color)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-gray-400 group-hover:text-blue-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                Ver detalhes →
              </p>
            </Link>
          )
        })}
      </div>}

      {/* ===== CRM Marketing — link compacto (09/06: era card gigante com gradient
           tomando todo espaco — agora 1 linha discreta com mesma funcionalidade) ===== */}
      {isWidgetVisible('marketing_card') && (isAdmin || user?.isSuperAdmin) && (
        <Link
          href="/marketing"
          aria-label="Acessar módulo CRM Marketing — contatos, campanhas e segmentos"
          className="group flex items-center justify-between gap-3 rounded-lg border bg-white px-4 py-2.5 shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/30"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-indigo-100 p-1.5 text-indigo-600">
              <Megaphone className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-gray-900">CRM Marketing</span>
            <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">Novo</span>
            <span className="hidden sm:inline text-xs text-gray-500 truncate">Contatos, campanhas e segmentos</span>
          </div>
          <ArrowRight className="h-4 w-4 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-600" />
        </Link>
      )}

      {/* ===== Cobranças Asaas (feature 2026-05-14 feat 3/4) ===== */}
      {isWidgetVisible('charges_summary') && canViewFinanceiro && <ChargesSummaryWidget />}

      {/* ===== Voip stats ===== */}
      <VoipDashboardCard />

      {/* ===== Charts Row ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* OS por Semana */}
        {isWidgetVisible('chart_os_week') && <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-gray-900">OS por Semana</h2>
          {loading ? (
            <div className="flex h-52 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
            </div>
          ) : (stats?.osPerWeek?.length ?? 0) === 0 ? (
            <p className="flex h-52 items-center justify-center text-sm text-gray-400">Sem dados</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={stats!.osPerWeek}
                margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
                onClick={(e: any) => {
                  // UX-8 #1: drill-down — clicar em barra leva pra lista filtrada
                  if (!e?.activeLabel) return
                  // Formato dia/mes "DD/MM" — converter pra ?from=YYYY-MM-DD
                  const [d, m] = String(e.activeLabel).split('/')
                  if (!d || !m) return
                  const yr = new Date().getFullYear()
                  const from = `${yr}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
                  // Adiciona 6 dias pro range (semana)
                  const fromDate = new Date(from)
                  const to = new Date(fromDate.getTime() + 6 * 86400000).toISOString().slice(0,10)
                  router.push(`/os?from=${from}&to=${to}`)
                }}
              >
                <XAxis dataKey="week" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
                  labelFormatter={(v) => `Semana ${v}`}
                />
                <Bar dataKey="count" name="OS" fill="#3b82f6" radius={[6, 6, 0, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>}

        {/* Pipeline de OS — funnel horizontal (substitui PieChart 09/06: legibilidade
            + tomada de decisao instantanea, padrao Pipedrive/Bling) */}
        {isWidgetVisible('chart_pipeline') && <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900">Pipeline de OS</h2>
            <span className="text-[10px] uppercase tracking-wider text-gray-400">Clique no card pra filtrar</span>
          </div>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
            </div>
          ) : (stats?.pipeline?.length ?? 0) === 0 ? (
            <p className="flex h-40 items-center justify-center text-sm text-gray-400">Sem dados</p>
          ) : (() => {
            const stages = stats!.pipeline
            const total = stages.reduce((s, p) => s + p.count, 0)
            const max = Math.max(1, ...stages.map(p => p.count))
            const goTo = (stage: { id?: string; name: string }) => {
              if (stage.id) router.push(`/os?status=${encodeURIComponent(stage.id)}`)
              else router.push(`/os?search=${encodeURIComponent(stage.name)}`)
            }
            return (
              <>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                  {stages.map(stage => {
                    const pct = total > 0 ? Math.round((stage.count / total) * 100) : 0
                    const barPct = (stage.count / max) * 100
                    return (
                      <button
                        key={stage.id || stage.name}
                        type="button"
                        onClick={() => goTo(stage)}
                        className="group relative cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                        style={{ borderLeftWidth: '4px', borderLeftColor: stage.color }}
                        title={`${stage.count} OS em "${stage.name}" (${pct}% do total) — clique pra filtrar`}
                      >
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="text-2xl font-bold leading-none" style={{ color: stage.color }}>
                            {stage.count}
                          </span>
                          <span className="text-[10px] font-medium text-gray-400">{pct}%</span>
                        </div>
                        <div className="mt-1.5 truncate text-xs font-medium text-gray-700">{stage.name}</div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${barPct}%`, backgroundColor: stage.color }}
                          />
                        </div>
                        <ArrowRight className="absolute right-2 top-2 h-3 w-3 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    )
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                  <span>Total ativo: <strong className="text-gray-900">{total}</strong> OS</span>
                  {stats?.osAtrasadas ? (
                    <button
                      type="button"
                      onClick={() => router.push('/os?overdue=1')}
                      className="cursor-pointer font-medium text-red-600 hover:underline"
                    >
                      {stats.osAtrasadas} atrasadas →
                    </button>
                  ) : null}
                </div>
              </>
            )
          })()}
        </div>}
      </div>

      {/* ===== Metrics Row ===== */}
      {/* UX-4 #11: KPI semáforo — borda colorida + dot indicando saúde */}
      {isWidgetVisible('metrics') && (() => {
        const repairDays = stats?.metrics.avgRepairDays
        const approvalRate = stats?.metrics.approvalRate
        // Thresholds (ajustáveis no futuro via tabela `kpi_thresholds`)
        const repairSeverity = repairDays == null ? 'neutral' : repairDays <= 3 ? 'good' : repairDays <= 5 ? 'warn' : 'bad'
        const approvalSeverity = approvalRate == null ? 'neutral' : approvalRate >= 80 ? 'good' : approvalRate >= 60 ? 'warn' : 'bad'
        const sevClass = (s: string) =>
          s === 'good' ? 'border-l-4 border-l-emerald-500' :
          s === 'warn' ? 'border-l-4 border-l-amber-500' :
          s === 'bad' ? 'border-l-4 border-l-red-500' :
          'border-l-4 border-l-gray-200'
        const sevDot = (s: string) =>
          s === 'good' ? 'bg-emerald-500' :
          s === 'warn' ? 'bg-amber-500' :
          s === 'bad' ? 'bg-red-500' :
          'bg-gray-300'
        return (
          <div className={cn('grid grid-cols-1 gap-4', canViewFinanceiro ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
            <div className={cn('rounded-xl border bg-white p-5 shadow-sm', sevClass(repairSeverity))}>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-purple-50 p-2.5">
                  <Clock className="h-5 w-5 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-500">Tempo Medio de Reparo</p>
                    <span className={cn('w-2 h-2 rounded-full', sevDot(repairSeverity))} aria-label={`Status: ${repairSeverity}`} />
                  </div>
                  <p className="mt-0.5 text-xl font-bold text-gray-900">
                    {loading ? '...' : repairDays != null ? `${repairDays} dias` : '—'}
                  </p>
                </div>
              </div>
            </div>

            <div className={cn('rounded-xl border bg-white p-5 shadow-sm', sevClass(approvalSeverity))}>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-teal-50 p-2.5">
                  <Target className="h-5 w-5 text-teal-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-500">Taxa de Aprovacao</p>
                    <span className={cn('w-2 h-2 rounded-full', sevDot(approvalSeverity))} aria-label={`Status: ${approvalSeverity}`} />
                  </div>
                  <p className="mt-0.5 text-xl font-bold text-gray-900">
                    {loading ? '...' : approvalRate != null ? `${approvalRate}%` : '—'}
                  </p>
                </div>
              </div>
            </div>

            {canViewFinanceiro && (
              <div className="rounded-xl border bg-white p-5 shadow-sm border-l-4 border-l-gray-200">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-green-50 p-2.5">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-500">Ticket Medio</p>
                    <p className="mt-0.5 text-xl font-bold text-gray-900">
                      {loading ? '...' : stats?.metrics.avgTicketCents != null ? formatCurrency(stats.metrics.avgTicketCents) : '—'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* ===== Recent Activity ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Últimas OS */}
        {isWidgetVisible('recent_os') && <div className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="font-semibold text-gray-900">Últimas OS</h2>
            <Link href="/os" className="flex items-center gap-1 text-sm text-blue-600 hover:underline">
              Ver todas <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="divide-y">
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
              </div>
            ) : (stats?.recentOs?.length ?? 0) === 0 ? (
              <p className="p-5 text-sm text-gray-400">Nenhuma OS encontrada</p>
            ) : (
              stats!.recentOs.map(os => (
                <Link key={os.id} href={`/os/${os.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  {/* Bug #30 (audit 31/05): OS-XXXXX quebrava em 2 linhas com clientes de nome longo
                      (span inline sem shrink-0 + truncate no nome dentro do mesmo elemento). */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="font-medium text-gray-900 shrink-0 whitespace-nowrap">OS-{String(os.os_number).padStart(4, '0')}</span>
                    <span className="text-sm text-gray-500 truncate">{os.customer_name}</span>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: os.status_color + '20', color: os.status_color }}
                  >
                    {os.status_name}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>}

        {/* Ultimas Contas a Receber — only for users with financeiro.view */}
        {isWidgetVisible('receivables') && canViewFinanceiro && (
          <div className="rounded-xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="font-semibold text-gray-900">Contas a Receber</h2>
              <Link href="/financeiro" className="flex items-center gap-1 text-sm text-blue-600 hover:underline">
                Ver todas <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="divide-y">
              {loading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                </div>
              ) : (stats?.recentReceivable?.length ?? 0) === 0 ? (
                <p className="p-5 text-sm text-gray-400">Nenhuma conta encontrada</p>
              ) : (
                stats!.recentReceivable.map(r => (
                  <Link key={r.id} href={`/financeiro/contas-receber/${r.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className="min-w-0 flex-1">
                      {/* Bug #28b (audit 31/05): widget também precisa do cleanDescription */}
                      <p className="text-sm font-medium text-gray-900 truncate">{cleanDescription(r.description)}</p>
                      <p className="text-xs text-gray-400">{r.customer_name} &middot; Venc. {formatDate(r.due_date)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className="text-sm font-semibold text-gray-900">{formatCurrency(r.total_amount)}</span>
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-medium',
                        receivableStatusStyle[r.status ?? 'PENDENTE'] ?? 'bg-gray-100 text-gray-600'
                      )}>
                        {receivableStatusLabel[r.status ?? 'PENDENTE'] ?? r.status}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Carga de Trabalho por Técnico */}
      {isWidgetVisible('tech_workload') && stats && (stats.techWorkload?.length > 0 || stats.semTecnico > 0) && (
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Wrench className="h-4 w-4 text-blue-600" /> Carga de Trabalho — Técnicos
            </h2>
            <div className="flex gap-3 text-xs">
              {(stats.osAtrasadas ?? 0) > 0 && (
                <span className="px-2 py-1 rounded-full bg-red-100 text-red-700 font-semibold">{stats.osAtrasadas} atrasada{stats.osAtrasadas > 1 ? 's' : ''}</span>
              )}
              {(stats.semTecnico ?? 0) > 0 && (
                <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-semibold">{stats.semTecnico} sem técnico</span>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-2.5">Técnico</th>
                  <th className="px-4 py-2.5 text-center">OS Pendentes</th>
                  <th className="px-4 py-2.5 text-center">Em Execução</th>
                  <th className="px-4 py-2.5 text-center">Atrasadas</th>
                  <th className="px-4 py-2.5">Carga</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stats.techWorkload.map(tech => {
                  const maxTotal = Math.max(...stats.techWorkload.map(t => t.total), 1)
                  return (
                    <tr key={tech.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        {/* Bug #48 (audit 31/05 Karlão): antes link ia pra /tecnico
                            (Meu Painel do user logado), ignorando o tech.id passado.
                            Admin clicando em "Luiz" via Carga de Trabalho via parar
                            no próprio painel. Agora vai pra /os filtrado. */}
                        <Link href={`/os?assignedTo=${tech.id}`} className="font-medium text-gray-900 hover:text-blue-600">{tech.name}</Link>
                      </td>
                      <td className="px-4 py-2.5 text-center font-semibold text-gray-900">{tech.total}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', tech.em_execucao > 0 ? 'bg-blue-100 text-blue-700' : 'text-gray-400')}>{tech.em_execucao}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', tech.atrasadas > 0 ? 'bg-red-100 text-red-700' : 'text-gray-400')}>{tech.atrasadas}</span>
                      </td>
                      <td className="px-4 py-2.5 w-40">
                        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', tech.atrasadas > 0 ? 'bg-red-500' : 'bg-blue-500')}
                            style={{ width: `${(tech.total / maxTotal) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {(stats.semTecnico ?? 0) > 0 && (
                  <tr className="hover:bg-gray-50 bg-amber-50/50">
                    <td className="px-4 py-2.5">
                      <Link href="/os?no_tech=1" className="font-medium text-amber-700 hover:text-amber-900">Sem técnico atribuído</Link>
                    </td>
                    <td className="px-4 py-2.5 text-center font-semibold text-amber-700">{stats.semTecnico}</td>
                    <td className="px-4 py-2.5 text-center text-gray-400">—</td>
                    <td className="px-4 py-2.5 text-center text-gray-400">—</td>
                    <td className="px-4 py-2.5 text-xs text-amber-600">Atribuir tecnico</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
