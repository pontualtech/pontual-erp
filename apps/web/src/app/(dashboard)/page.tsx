'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/use-auth'
import { ClipboardList, Users, DollarSign, AlertTriangle, Package, Bell, Pin, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

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

interface OsDashboard {
  totalOpen: number
  totalPeriod: number
  overdueCount: number
  revenue: number
  byStatus: { _count: { id: number }; status_id: string }[]
  byPriority: { _count: { id: number }; priority: string }[]
  byType: { _count: { id: number }; os_type: string }[]
}

interface EstoqueDashboard {
  totalProducts: number
  stockValueCents: number
  outOfStock: number
  belowMin: number
  movementsLast30Days: number
}

interface FinanceiroDashboard {
  totalBalanceCents: number
  accounts: unknown[]
  payable: { openCents: number; openCount: number; overdueCents: number; overdueCount: number }
  receivable: { openCents: number; openCount: number; overdueCents: number; overdueCount: number }
}

interface OsItem {
  id: string
  os_number: number
  status_id: string
  priority: string
  equipment_type: string | null
  created_at: string
  customers: { id: string; legal_name: string; phone: string | null } | null
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function DashboardPage() {
  const { user, isAdmin } = useAuth()
  const [osDash, setOsDash] = useState<OsDashboard | null>(null)
  const [estoqueDash, setEstoqueDash] = useState<EstoqueDashboard | null>(null)
  const [financeiroDash, setFinanceiroDash] = useState<FinanceiroDashboard | null>(null)
  const [recentOs, setRecentOs] = useState<OsItem[]>([])
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [loading, setLoading] = useState(true)
  const [showAvisoModal, setShowAvisoModal] = useState(false)
  const [avisoForm, setAvisoForm] = useState({ title: '', message: '', priority: 'NORMAL', pinned: false, expires_at: '' })

  const loadAvisos = () => {
    fetch('/api/avisos').then(r => r.json()).then(d => setAvisos(d.data ?? [])).catch(() => toast.error('Erro ao carregar avisos'))
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/os/dashboard').then(r => r.json()).then(d => setOsDash(d.data)).catch(() => toast.error('Erro ao carregar dados de OS')),
      fetch('/api/estoque/dashboard').then(r => r.json()).then(d => setEstoqueDash(d.data)).catch(() => toast.error('Erro ao carregar dados de estoque')),
      fetch('/api/financeiro/dashboard').then(r => r.json()).then(d => setFinanceiroDash(d.data)).catch(() => toast.error('Erro ao carregar dados financeiros')),
      fetch('/api/os?limit=5').then(r => r.json()).then(d => setRecentOs(d.data ?? [])).catch(() => toast.error('Erro ao carregar OS recentes')),
    ]).finally(() => setLoading(false))
    loadAvisos()
  }, [])

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) { if (e.key === 'Escape') { setShowAvisoModal(false) } }
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

  const cards = [
    { label: 'OS Abertas', value: osDash?.totalOpen ?? 0, icon: ClipboardList, color: 'text-blue-600 bg-blue-50' },
    { label: 'Estoque Baixo', value: (estoqueDash?.belowMin ?? 0), icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    { label: 'A Receber', value: formatCurrency(financeiroDash?.receivable?.openCents ?? 0), icon: DollarSign, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'A Pagar', value: formatCurrency(financeiroDash?.payable?.openCents ?? 0), icon: Package, color: 'text-orange-600 bg-orange-50' },
  ]

  const osPriorityLabel: Record<string, string> = {
    LOW: 'Baixa',
    MEDIUM: 'Normal',
    HIGH: 'Alta',
    URGENT: 'Urgente',
  }

  const osPriorityColor: Record<string, string> = {
    LOW: 'bg-gray-100 text-gray-600',
    MEDIUM: 'bg-blue-100 text-blue-700',
    HIGH: 'bg-orange-100 text-orange-700',
    URGENT: 'bg-red-100 text-red-700',
  }

  const formatAvisoDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Announcements section */}
      {avisos.length > 0 && (
        <div className="rounded-lg border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-500" />
              Avisos
            </h2>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button
                  onClick={() => setShowAvisoModal(true)}
                  className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Plus className="h-3 w-3" />
                  Novo Aviso
                </button>
              )}
              <Link href="/avisos" className="text-sm text-blue-600 hover:underline">Ver todos</Link>
            </div>
          </div>
          <div className="divide-y">
            {avisos.slice(0, 5).map(aviso => (
              <div key={aviso.id} className="px-5 py-3">
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
            ))}
          </div>
        </div>
      )}

      {/* Inline create announcement modal */}
      {showAvisoModal && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAvisoModal(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Novo Aviso</h3>
              <button type="button" title="Fechar" onClick={() => setShowAvisoModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                value={avisoForm.title}
                onChange={e => setAvisoForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Titulo do aviso"
                className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <textarea
                value={avisoForm.message}
                onChange={e => setAvisoForm(f => ({ ...f, message: e.target.value }))}
                placeholder="Mensagem"
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none"
              />
              <div className="flex flex-wrap gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Prioridade</label>
                  <select
                    value={avisoForm.priority}
                    onChange={e => setAvisoForm(f => ({ ...f, priority: e.target.value }))}
                    title="Prioridade"
                    className="rounded-lg border px-3 py-1.5 text-sm"
                  >
                    <option value="INFO">Info</option>
                    <option value="NORMAL">Normal</option>
                    <option value="IMPORTANTE">Importante</option>
                    <option value="URGENTE">Urgente</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Expira em</label>
                  <input
                    type="datetime-local"
                    value={avisoForm.expires_at}
                    onChange={e => setAvisoForm(f => ({ ...f, expires_at: e.target.value }))}
                    title="Data de expiracao"
                    className="rounded-lg border px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={avisoForm.pinned}
                      onChange={e => setAvisoForm(f => ({ ...f, pinned: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">Fixar</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={createAviso}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Publicar
                </button>
                <button
                  onClick={() => setShowAvisoModal(false)}
                  className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* If no announcements but admin, show create button */}
      {avisos.length === 0 && isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowAvisoModal(true)}
            className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600"
          >
            <Bell className="h-4 w-4" />
            Criar primeiro aviso
          </button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-lg border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">
                    {loading ? '...' : card.value}
                  </p>
                </div>
                <div className={cn('rounded-lg p-2.5', card.color)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Recent OS */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">OS Recentes</h2>
          <Link href="/os" className="text-sm text-blue-600 hover:underline">Ver todas</Link>
        </div>
        <div className="divide-y">
          {loading ? (
            <p className="p-5 text-sm text-gray-400">Carregando...</p>
          ) : recentOs.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">Nenhuma OS encontrada</p>
          ) : (
            recentOs.map(os => (
              <Link key={os.id} href={`/os/${os.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div>
                  <span className="font-medium text-gray-900">OS-{String(os.os_number).padStart(4, '0')}</span>
                  <span className="ml-3 text-sm text-gray-500">{os.customers?.legal_name ?? 'Sem cliente'}</span>
                </div>
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', osPriorityColor[os.priority] ?? 'bg-gray-100 text-gray-700')}>
                  {osPriorityLabel[os.priority] ?? os.priority}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
