'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Building2, Users, ClipboardList, UserCheck, TrendingUp, Loader2 } from 'lucide-react'

interface Stats {
  totals: {
    companies: number
    activeCompanies: number
    users: number
    serviceOrders: number
    customers: number
    osLast30Days: number
  }
  companies: {
    id: string
    name: string
    slug: string
    created_at: string
    _count: { service_orders: number; customers: number; user_profiles: number }
  }[]
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/stats')
      .then(r => r.json())
      .then(d => setStats(d.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
      </div>
    )
  }

  if (!stats) {
    return <p className="text-center text-gray-500 py-20">Erro ao carregar dados</p>
  }

  const cards = [
    { label: 'Empresas Ativas', value: stats.totals.activeCompanies, icon: Building2, color: 'text-amber-400 bg-amber-400/10' },
    { label: 'Usuários Ativos', value: stats.totals.users, icon: Users, color: 'text-blue-400 bg-blue-400/10' },
    { label: 'Total de OS', value: stats.totals.serviceOrders, icon: ClipboardList, color: 'text-emerald-400 bg-emerald-400/10' },
    { label: 'Total de Clientes', value: stats.totals.customers, icon: UserCheck, color: 'text-purple-400 bg-purple-400/10' },
    { label: 'OS (últimos 30 dias)', value: stats.totals.osLast30Days, icon: TrendingUp, color: 'text-cyan-400 bg-cyan-400/10' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Dashboard SaaS</h1>
        <p className="text-sm text-gray-500">Visão geral de todas as empresas da plataforma</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{card.label}</p>
                <div className={`rounded-lg p-2 ${card.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-100">{card.value.toLocaleString('pt-BR')}</p>
            </div>
          )
        })}
      </div>

      {/* Company Table */}
      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-300">Empresas</h2>
          <Link
            href="/admin/empresas"
            className="text-xs text-amber-400 hover:text-amber-300"
          >
            Ver todas →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3 text-right">Usuários</th>
                <th className="px-4 py-3 text-right">OS</th>
                <th className="px-4 py-3 text-right">Clientes</th>
                <th className="px-4 py-3">Criada em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {stats.companies.map(c => (
                <tr key={c.id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/empresas/${c.id}`} className="font-medium text-gray-200 hover:text-amber-400">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{c.slug}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{c._count.user_profiles}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{c._count.service_orders}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{c._count.customers}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
