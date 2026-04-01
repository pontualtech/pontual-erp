'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Package, AlertTriangle, TrendingDown, DollarSign } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface EstoqueDashboard {
  totalProducts: number
  belowMin: number
  aboveMax: number
  stockValueCents: number
}

interface Alerta {
  id: string
  product_name: string
  current_stock: number
  min_stock: number
  unit: string
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function EstoquePage() {
  const [stats, setStats] = useState<EstoqueDashboard | null>(null)
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/estoque/dashboard').then(r => r.json()),
      fetch('/api/estoque/alertas').then(r => r.json()),
    ])
      .then(([dashData, alertData]) => {
        setStats(dashData.data ?? dashData)
        setAlertas(alertData.data ?? alertData ?? [])
      })
      .catch(() => toast.error('Erro ao carregar dados de estoque'))
      .finally(() => setLoading(false))
  }, [])

  const cards = [
    { label: 'Total de Produtos', value: stats?.totalProducts ?? 0, icon: Package, color: 'text-blue-600 bg-blue-50' },
    { label: 'Abaixo do Minimo', value: stats?.belowMin ?? 0, icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    { label: 'Acima do Maximo', value: stats?.aboveMax ?? 0, icon: TrendingDown, color: 'text-orange-600 bg-orange-50' },
    { label: 'Valor em Estoque', value: formatCurrency(stats?.stockValueCents ?? 0), icon: DollarSign, color: 'text-emerald-600 bg-emerald-50' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Estoque</h1>
        <Link
          href="/estoque/movimentar"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Movimentar Estoque
        </Link>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-lg border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{loading ? '...' : card.value}</p>
                </div>
                <div className={cn('rounded-lg p-2.5', card.color)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Alertas de estoque */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">Alertas de Estoque</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Estoque Atual</th>
                <th className="px-4 py-3">Estoque Minimo</th>
                <th className="px-4 py-3">Faltando</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
              ) : alertas.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Nenhum alerta de estoque</td></tr>
              ) : (
                alertas.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{a.product_name}</td>
                    <td className="px-4 py-3 text-red-600 font-medium">{a.current_stock} {a.unit}</td>
                    <td className="px-4 py-3 text-gray-500">{a.min_stock} {a.unit}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        -{a.min_stock - a.current_stock} {a.unit}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
