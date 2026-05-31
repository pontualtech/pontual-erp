'use client'

import { Landmark } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Account {
  id: string
  name: string
  account_type?: string
  current_balance: number | null
}

interface Props {
  accounts: Account[]
  loading?: boolean
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

const typeLabels: Record<string, string> = {
  CHECKING: 'Conta corrente',
  SAVINGS: 'Poupança',
  GATEWAY: 'Gateway',
  CASH: 'Caixa',
}

// Distribuição de saldo por conta com barra horizontal (% relativo ao maior).
// Negativos têm barra cinza e valor vermelho (sinal claro de visualização).
export function ContasDistribuicao({ accounts, loading }: Props) {
  const max = Math.max(0, ...accounts.map((a) => Math.abs(a.current_balance ?? 0)))
  const totalPositive = accounts.reduce((s, a) => s + Math.max(0, a.current_balance ?? 0), 0)

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-emerald-500" />
          <h2 className="text-base font-semibold text-gray-900">Contas bancárias</h2>
        </div>
        <span className="text-xs text-gray-500 tabular-nums">{accounts.length} {accounts.length === 1 ? 'conta' : 'contas'}</span>
      </div>

      <div className="divide-y divide-gray-100">
        {loading ? (
          <SkeletonRows />
        ) : accounts.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">Nenhuma conta cadastrada</p>
        ) : (
          accounts.map((a) => {
            const balance = a.current_balance ?? 0
            const widthPct = max > 0 ? (Math.abs(balance) / max) * 100 : 0
            const sharePct = totalPositive > 0 && balance > 0 ? (balance / totalPositive) * 100 : null
            const isNegative = balance < 0
            return (
              <div key={a.id} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{a.name}</p>
                    <p className="text-[11px] text-gray-400">{typeLabels[a.account_type ?? ''] ?? a.account_type ?? 'Conta'}</p>
                  </div>
                  <div className="flex items-baseline gap-2">
                    {sharePct !== null && (
                      <span className="text-[11px] text-gray-400 tabular-nums">{sharePct.toFixed(0)}%</span>
                    )}
                    <span className={cn('text-sm font-semibold tabular-nums', isNegative ? 'text-red-600' : 'text-gray-900')}>
                      {formatBRL(balance)}
                    </span>
                  </div>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500', isNegative ? 'bg-red-300' : 'bg-emerald-500')}
                    style={{ width: `${Math.max(widthPct, balance === 0 ? 0 : 4)}%` }}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function SkeletonRows() {
  return (
    <div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2 px-5 py-3">
          <div className="flex animate-pulse items-baseline justify-between">
            <div className="h-3 w-24 rounded bg-gray-100" />
            <div className="h-3 w-20 rounded bg-gray-100" />
          </div>
          <div className="h-1.5 w-3/4 animate-pulse rounded-full bg-gray-100" />
        </div>
      ))}
    </div>
  )
}
