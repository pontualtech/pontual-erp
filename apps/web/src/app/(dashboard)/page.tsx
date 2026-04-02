'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/use-auth'
import {
  ClipboardList, Wrench, Truck, DollarSign,
  Bell, Pin, Plus, X, Clock, TrendingUp, Target,
  ArrowRight, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
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
    faturamentoMesCents: number
  }
  osPerWeek: { week: string; count: number }[]
  pipeline: { name: string; color: string; count: number }[]
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
}

/* ---------- Helpers ---------- */

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
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
  const { user, isAdmin } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [loading, setLoading] = useState(true)
  const [showAvisoModal, setShowAvisoModal] = useState(false)
  const [avisoForm, setAvisoForm] = useState({ title: '', message: '', priority: 'NORMAL', pinned: false, expires_at: '' })

  const loadAvisos = () => {
    fetch('/api/avisos').then(r => r.json()).then(d => setAvisos(d.data ?? [])).catch(() => {})
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/dashboard/stats').then(r => r.json()).then(d => setStats(d.data)).catch(() => toast.error('Erro ao carregar dashboard')),
    ]).finally(() => setLoading(false))
    loadAvisos()
  }, [])

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

  const cards = [
    { label: 'OS Abertas Hoje', value: stats?.cards.osAbertasHoje ?? 0, icon: ClipboardList, color: 'text-blue-600 bg-blue-50' },
    { label: 'OS em Execucao', value: stats?.cards.osEmExecucao ?? 0, icon: Wrench, color: 'text-amber-600 bg-amber-50' },
    { label: 'Prontas p/ Entrega', value: stats?.cards.osProntas ?? 0, icon: Truck, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Faturamento do Mes', value: formatCurrency(stats?.cards.faturamentoMesCents ?? 0), icon: DollarSign, color: 'text-green-600 bg-green-50' },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* ===== Avisos ===== */}
      {avisos.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-500" />
              Avisos
            </h2>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button type="button" onClick={() => setShowAvisoModal(true)}
                  className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700">
                  <Plus className="h-3 w-3" /> Novo Aviso
                </button>
              )}
              <Link href="/avisos" className="text-sm text-blue-600 hover:underline">Ver todos</Link>
            </div>
          </div>
          <div className="divide-y">
            {avisos.slice(0, 3).map(aviso => (
              <div key={aviso.id} className="px-5 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {aviso.pinned && <Pin className="h-3 w-3 text-amber-500" />}
                  <span className="font-medium text-gray-900">{aviso.title}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', priorityStyle[aviso.priority] || 'bg-gray-100 text-gray-600')}>
                    {priorityLabel[aviso.priority] || aviso.priority}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-gray-600 line-clamp-1">{aviso.message}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                  {aviso.author_name && <span>{aviso.author_name}</span>}
                  <span>{formatAvisoDate(aviso.created_at)}</span>
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

      {/* ===== Summary Cards ===== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">
                    {loading ? <Loader2 className="h-5 w-5 animate-spin text-gray-300" /> : card.value}
                  </p>
                </div>
                <div className={cn('rounded-xl p-2.5', card.color)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ===== Charts Row ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* OS por Semana */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-gray-900">OS por Semana</h2>
          {loading ? (
            <div className="flex h-52 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
            </div>
          ) : (stats?.osPerWeek?.length ?? 0) === 0 ? (
            <p className="flex h-52 items-center justify-center text-sm text-gray-400">Sem dados</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats!.osPerWeek} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <XAxis dataKey="week" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
                  labelFormatter={(v) => `Semana ${v}`}
                />
                <Bar dataKey="count" name="OS" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Pipeline de OS */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-gray-900">Pipeline de OS</h2>
          {loading ? (
            <div className="flex h-52 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
            </div>
          ) : (stats?.pipeline?.length ?? 0) === 0 ? (
            <p className="flex h-52 items-center justify-center text-sm text-gray-400">Sem dados</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={stats!.pipeline.filter(p => p.count > 0)}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="40%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                  label={false}
                >
                  {stats!.pipeline.filter(p => p.count > 0).map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
                  formatter={(value: number) => [`${value} OS`, '']}
                />
                <Legend
                  verticalAlign="bottom"
                  align="center"
                  layout="horizontal"
                  wrapperStyle={{ fontSize: '11px', lineHeight: '18px', paddingTop: '8px' }}
                  formatter={(value: string) => {
                    const item = stats!.pipeline.find(p => p.name === value)
                    return `${value} (${item?.count ?? 0})`
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ===== Metrics Row ===== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-purple-50 p-2.5">
              <Clock className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Tempo Medio de Reparo</p>
              <p className="mt-0.5 text-xl font-bold text-gray-900">
                {loading ? '...' : stats?.metrics.avgRepairDays != null ? `${stats.metrics.avgRepairDays} dias` : '—'}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-teal-50 p-2.5">
              <Target className="h-5 w-5 text-teal-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Taxa de Aprovacao</p>
              <p className="mt-0.5 text-xl font-bold text-gray-900">
                {loading ? '...' : stats?.metrics.approvalRate != null ? `${stats.metrics.approvalRate}%` : '—'}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-green-50 p-2.5">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Ticket Medio</p>
              <p className="mt-0.5 text-xl font-bold text-gray-900">
                {loading ? '...' : stats?.metrics.avgTicketCents != null ? formatCurrency(stats.metrics.avgTicketCents) : '—'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Recent Activity ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Ultimas OS */}
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="font-semibold text-gray-900">Ultimas OS</h2>
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
                  className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900">OS-{String(os.os_number).padStart(4, '0')}</span>
                    <span className="ml-3 text-sm text-gray-500 truncate">{os.customer_name}</span>
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
        </div>

        {/* Ultimas Contas a Receber */}
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
                <div key={r.id} className="flex items-center justify-between px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.description}</p>
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
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
