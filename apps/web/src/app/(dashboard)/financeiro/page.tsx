'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { TrendingUp, TrendingDown, DollarSign, AlertTriangle, Landmark, FolderTree, Target, CreditCard, BarChart3, FileSpreadsheet, Receipt } from 'lucide-react'
import { toast } from 'sonner'

interface FinanceiroDashboard {
  totalBalanceCents: number
  accounts: { id: string; name: string; balance_cents: number; type: string }[]
  payable: { openCents: number; openCount: number; overdueCents: number; overdueCount: number }
  receivable: { openCents: number; openCount: number; overdueCents: number; overdueCount: number }
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function FinanceiroPage() {
  const [data, setData] = useState<FinanceiroDashboard | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/financeiro/dashboard')
      .then(r => r.json())
      .then(d => setData(d.data ?? null))
      .catch(() => toast.error('Erro ao carregar dados financeiros'))
      .finally(() => setLoading(false))
  }, [])

  const cards = [
    { label: 'Saldo Total', value: formatCurrency(data?.totalBalanceCents ?? 0), icon: DollarSign, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'A Receber', value: formatCurrency(data?.receivable?.openCents ?? 0), sub: data?.receivable?.openCount ? `${data.receivable.openCount} titulo(s)` : null, icon: TrendingUp, color: 'text-green-600 bg-green-50' },
    { label: 'A Pagar', value: formatCurrency(data?.payable?.openCents ?? 0), sub: data?.payable?.openCount ? `${data.payable.openCount} titulo(s)` : null, icon: TrendingDown, color: 'text-red-600 bg-red-50' },
    { label: 'Vencidos', value: formatCurrency((data?.payable?.overdueCents ?? 0) + (data?.receivable?.overdueCents ?? 0)), sub: ((data?.payable?.overdueCount ?? 0) + (data?.receivable?.overdueCount ?? 0)) > 0 ? `${(data?.payable?.overdueCount ?? 0) + (data?.receivable?.overdueCount ?? 0)} titulo(s)` : null, icon: AlertTriangle, color: 'text-orange-600 bg-orange-50' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Financeiro</h1>
        <div className="flex gap-2">
          <Link href="/financeiro/contas-receber" className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
            Contas a Receber
          </Link>
          <Link href="/financeiro/contas-pagar" className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
            Contas a Pagar
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-lg border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{loading ? '...' : card.value}</p>
                  {'sub' in card && card.sub && (
                    <p className="mt-0.5 text-xs text-gray-400">{card.sub}</p>
                  )}
                </div>
                <div className={cn('rounded-lg p-2.5', card.color)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Accounts summary */}
      {(data?.accounts ?? []).length > 0 && (
        <div className="rounded-lg border bg-white shadow-sm">
          <div className="border-b px-5 py-3">
            <h2 className="font-semibold text-gray-900">Contas</h2>
          </div>
          <div className="divide-y">
            {data!.accounts.map((acc: any) => (
              <div key={acc.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{acc.name}</p>
                  <p className="text-xs text-gray-400">{acc.type}</p>
                </div>
                <span className={cn('text-sm font-semibold', acc.balance_cents >= 0 ? 'text-green-600' : 'text-red-600')}>
                  {formatCurrency(acc.balance_cents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation cards */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">Cadastros</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Categorias', href: '/financeiro/categorias', icon: FolderTree, desc: 'Receitas e despesas', color: 'text-purple-600 bg-purple-50' },
            { label: 'Centros de Custo', href: '/financeiro/centros-custo', icon: Target, desc: 'Departamentos', color: 'text-blue-600 bg-blue-50' },
            { label: 'Contas Bancárias', href: '/financeiro/contas-bancarias', icon: Landmark, desc: 'Bancos e caixas', color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Cond. Pagamento', href: '/financeiro/condicoes-pagamento', icon: CreditCard, desc: 'Parcelamentos', color: 'text-amber-600 bg-amber-50' },
            { label: 'Formas de Pgto', href: '/financeiro/formas-pagamento', icon: CreditCard, desc: 'Dinheiro, PIX, Cartão...', color: 'text-pink-600 bg-pink-50' },
          ].map(item => {
            const Icon = item.icon
            return (
              <Link key={item.href} href={item.href}
                className="flex items-start gap-3 rounded-lg border bg-white p-4 shadow-sm hover:border-blue-200 hover:bg-blue-50/50 transition-colors">
                <div className={cn('rounded-lg p-2', item.color)}><Icon className="h-4 w-4" /></div>
                <div>
                  <p className="font-medium text-gray-900 text-sm">{item.label}</p>
                  <p className="text-xs text-gray-500">{item.desc}</p>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">Relatórios</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Relatórios', href: '/financeiro/relatorios', icon: BarChart3, desc: 'Resumo e análises', color: 'text-blue-600 bg-blue-50' },
            { label: 'Fluxo de Caixa', href: '/financeiro/fluxo-caixa', icon: BarChart3, desc: 'Entradas e saídas', color: 'text-cyan-600 bg-cyan-50' },
            { label: 'DRE', href: '/financeiro/dre', icon: FileSpreadsheet, desc: 'Demonstrativo de resultados', color: 'text-indigo-600 bg-indigo-50' },
            { label: 'Conciliação', href: '/financeiro/conciliacao', icon: Receipt, desc: 'Importar OFX', color: 'text-teal-600 bg-teal-50' },
            { label: 'Boletos', href: '/financeiro/boletos', icon: Receipt, desc: 'Emitir e gerenciar', color: 'text-orange-600 bg-orange-50' },
            { label: 'CNAB Inter', href: '/financeiro/cnab', icon: FileSpreadsheet, desc: 'Remessa e retorno CNAB 400', color: 'text-amber-600 bg-amber-50' },
          ].map(item => {
            const Icon = item.icon
            return (
              <Link key={item.href} href={item.href}
                className="flex items-start gap-3 rounded-lg border bg-white p-4 shadow-sm hover:border-blue-200 hover:bg-blue-50/50 transition-colors">
                <div className={cn('rounded-lg p-2', item.color)}><Icon className="h-4 w-4" /></div>
                <div>
                  <p className="font-medium text-gray-900 text-sm">{item.label}</p>
                  <p className="text-xs text-gray-500">{item.desc}</p>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Empty state */}
      {!loading && (data?.accounts ?? []).length === 0 && (data?.payable?.openCount ?? 0) === 0 && (data?.receivable?.openCount ?? 0) === 0 && (
        <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
          <DollarSign className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-2 text-sm text-gray-400">Nenhum lançamento financeiro encontrado</p>
          <p className="text-xs text-gray-400">Cadastre contas bancárias e lançamentos para acompanhar suas finanças</p>
        </div>
      )}
    </div>
  )
}
