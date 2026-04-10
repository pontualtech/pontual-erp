'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

interface FinanceItem {
  os_id: string
  os_number: number
  equipment: string
  status: string
  status_color: string
  is_final: boolean
  total_cost: number
  total_cost_formatted: string
  payment_method: string | null
  payment_status: 'paid' | 'pending' | 'unpaid'
  paid_at: string | null
  pending_payment_id: string | null
  created_at: string
}

interface FinanceData {
  summary: { total: string; paid: string; pending: string }
  items: FinanceItem[]
}

export default function FinanceiroPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [data, setData] = useState<FinanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid'>('all')

  useEffect(() => {
    fetch('/api/portal/financeiro')
      .then(r => { if (r.status === 401) { router.push(`/portal/${slug}/login`); return null }; return r.json() })
      .then(res => { if (res?.data) setData(res.data) })
      .catch(() => toast.error('Erro ao carregar financeiro'))
      .finally(() => setLoading(false))
  }, [slug, router])

  const filtered = data?.items.filter(i => {
    if (filter === 'unpaid') return i.payment_status !== 'paid'
    if (filter === 'paid') return i.payment_status === 'paid'
    return true
  }) || []

  const statusBadge = (ps: string) => {
    if (ps === 'paid') return { label: 'Pago', cls: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-400' }
    if (ps === 'pending') return { label: 'PIX Pendente', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-400' }
    return { label: 'Aguardando', cls: 'bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-gray-400' }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <header className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/portal/${slug}`} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <h1 className="font-semibold text-gray-900 dark:text-gray-100">Financeiro</h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400" /></div>
        ) : !data || data.items.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-12 text-center">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">Nenhum valor em aberto</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.summary.total}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Total</p>
              </div>
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 text-center">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{data.summary.paid}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Pago</p>
              </div>
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 text-center">
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{data.summary.pending}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Pendente</p>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2">
              {(['all', 'unpaid', 'paid'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === f
                      ? 'bg-blue-600 dark:bg-blue-500 text-white'
                      : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-700'
                  }`}
                >
                  {f === 'all' ? 'Todos' : f === 'unpaid' ? 'Pendentes' : 'Pagos'}
                </button>
              ))}
            </div>

            {/* Items */}
            <div className="space-y-3">
              {filtered.map(item => {
                const badge = statusBadge(item.payment_status)
                return (
                  <div key={item.os_id} className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-gray-900 dark:text-gray-100">OS #{item.os_number}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{item.equipment}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                          <span style={{ color: item.status_color }}>{item.status}</span>
                          <span>{new Date(item.created_at).toLocaleDateString('pt-BR')}</span>
                          {item.payment_method && <span>Forma: {item.payment_method}</span>}
                          {item.paid_at && <span>Pago em: {new Date(item.paid_at).toLocaleDateString('pt-BR')}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{item.total_cost_formatted}</p>
                        {item.payment_status === 'paid' ? (
                          <span className="inline-block mt-2 px-3 py-1.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400 text-xs font-semibold rounded-lg">
                            Paga
                          </span>
                        ) : (
                          <span className="inline-block mt-2 px-3 py-1.5 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-400 text-xs font-semibold rounded-lg">
                            Pendente
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {filtered.length === 0 && (
              <p className="text-center text-gray-400 dark:text-gray-500 py-8">Nenhum item neste filtro</p>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 mt-12">
        <div className="max-w-4xl mx-auto px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-500">Powered by PontualERP</div>
      </footer>
    </div>
  )
}
