'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ClipboardList, Users, DollarSign, AlertTriangle, Package } from 'lucide-react'

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
  const [osDash, setOsDash] = useState<OsDashboard | null>(null)
  const [estoqueDash, setEstoqueDash] = useState<EstoqueDashboard | null>(null)
  const [financeiroDash, setFinanceiroDash] = useState<FinanceiroDashboard | null>(null)
  const [recentOs, setRecentOs] = useState<OsItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/os/dashboard').then(r => r.json()).then(d => setOsDash(d.data)).catch(() => {}),
      fetch('/api/estoque/dashboard').then(r => r.json()).then(d => setEstoqueDash(d.data)).catch(() => {}),
      fetch('/api/financeiro/dashboard').then(r => r.json()).then(d => setFinanceiroDash(d.data)).catch(() => {}),
      fetch('/api/os?limit=5').then(r => r.json()).then(d => setRecentOs(d.data ?? [])).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  const cards = [
    { label: 'OS Abertas', value: osDash?.totalOpen ?? 0, icon: ClipboardList, color: 'text-blue-600 bg-blue-50' },
    { label: 'Estoque Baixo', value: (estoqueDash?.belowMin ?? 0), icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    { label: 'A Receber', value: formatCurrency(financeiroDash?.receivable?.openCents ?? 0), icon: DollarSign, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'A Pagar', value: formatCurrency(financeiroDash?.payable?.openCents ?? 0), icon: Package, color: 'text-orange-600 bg-orange-50' },
  ]

  const priorityLabel: Record<string, string> = {
    LOW: 'Baixa',
    MEDIUM: 'Normal',
    HIGH: 'Alta',
    URGENT: 'Urgente',
  }

  const priorityColor: Record<string, string> = {
    LOW: 'bg-gray-100 text-gray-600',
    MEDIUM: 'bg-blue-100 text-blue-700',
    HIGH: 'bg-orange-100 text-orange-700',
    URGENT: 'bg-red-100 text-red-700',
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

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
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', priorityColor[os.priority] ?? 'bg-gray-100 text-gray-700')}>
                  {priorityLabel[os.priority] ?? os.priority}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
