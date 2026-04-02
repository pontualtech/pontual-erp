'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search, Download, Loader2, TrendingUp, TrendingDown, DollarSign, Wallet, ChevronDown, ChevronUp, Filter, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ExtratoItem {
  id: string; data: string; descricao: string; entidade: string
  conta_bancaria: string; centro_custo: string; categoria: string
  valor: number; tipo: 'ENTRADA' | 'SAIDA'; origem: string; reconciliado?: boolean
}

interface Resumo {
  saldo_anterior: number; entradas: number; saidas: number
  saldo_periodo: number; saldo_atual: number
}

interface Conta { id: string; name: string; bank_name: string | null; current_balance: number }
interface Categoria { id: string; name: string; module: string }
interface CentroCusto { id: string; name: string }

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function safeDate(v: string) {
  if (!v) return '--'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '--' : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

export default function ExtratoPage() {
  const now = new Date()
  const [items, setItems] = useState<ExtratoItem[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [contas, setContas] = useState<Conta[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [centrosCusto, setCentrosCusto] = useState<CentroCusto[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  // Filtros
  const [fromDate, setFromDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10))
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10))
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const loadData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    if (accountId) params.set('account_id', accountId)
    if (categoryId) params.set('category_id', categoryId)
    if (costCenterId) params.set('cost_center_id', costCenterId)
    if (search) params.set('search', search)
    params.set('page', String(page))
    params.set('limit', '50')

    fetch(`/api/financeiro/extrato?${params}`)
      .then(r => r.json())
      .then(d => {
        setItems(d.data?.items ?? [])
        setResumo(d.data?.resumo ?? null)
        setContas(d.data?.contas ?? [])
        setCategorias(d.data?.categorias ?? [])
        setCentrosCusto(d.data?.centros_custo ?? [])
        setTotal(d.data?.total ?? 0)
        setTotalPages(d.data?.totalPages ?? 1)
      })
      .catch(() => toast.error('Erro ao carregar extrato'))
      .finally(() => setLoading(false))
  }, [fromDate, toDate, accountId, categoryId, costCenterId, search, page])

  useEffect(() => { loadData() }, [loadData])

  function clearFilters() {
    setAccountId(''); setCategoryId(''); setCostCenterId(''); setSearch('')
    setFromDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10))
    setToDate(now.toISOString().slice(0, 10))
    setPage(1)
  }

  function exportCSV() {
    const header = 'Data;Lancamento;Entidade;Conta Bancaria;Centro Custo;Categoria;Valor;Tipo\n'
    const rows = items.map(i =>
      `${safeDate(i.data)};${i.descricao};${i.entidade};${i.conta_bancaria};${i.centro_custo};${i.categoria};${(i.valor / 100).toFixed(2).replace('.', ',')};${i.tipo}`
    ).join('\n')
    const bom = '\uFEFF'
    const blob = new Blob([bom + header + rows], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `extrato_${fromDate}_${toDate}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const hasFilters = accountId || categoryId || costCenterId || search

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/financeiro" className="rounded-lg p-2 hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Extrato</h1>
            <p className="text-sm text-gray-500">Lancamentos financeiros por periodo</p>
          </div>
        </div>
        <button type="button" onClick={exportCSV} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Download className="h-4 w-4" /> Exportar CSV
        </button>
      </div>

      {/* Resumo Cards */}
      {resumo && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-lg border bg-white p-4 shadow-sm text-center">
            <p className="text-xs text-gray-500 uppercase">Saldo Anterior</p>
            <p className="text-lg font-bold text-blue-700 mt-1">{fmt(resumo.saldo_anterior)}</p>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm text-center">
            <p className="text-xs text-gray-500 uppercase flex items-center justify-center gap-1"><TrendingUp className="h-3.5 w-3.5 text-green-500" /> Entradas</p>
            <p className="text-lg font-bold text-green-600 mt-1">{fmt(resumo.entradas)}</p>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm text-center">
            <p className="text-xs text-gray-500 uppercase flex items-center justify-center gap-1"><TrendingDown className="h-3.5 w-3.5 text-red-500" /> Saidas</p>
            <p className="text-lg font-bold text-red-600 mt-1">{fmt(resumo.saidas)}</p>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm text-center">
            <p className="text-xs text-gray-500 uppercase flex items-center justify-center gap-1"><DollarSign className="h-3.5 w-3.5" /> Saldo Periodo</p>
            <p className={cn('text-lg font-bold mt-1', resumo.saldo_periodo >= 0 ? 'text-green-600' : 'text-red-600')}>{fmt(resumo.saldo_periodo)}</p>
          </div>
          <div className="rounded-lg border bg-gradient-to-r from-blue-50 to-indigo-50 p-4 shadow-sm text-center">
            <p className="text-xs text-gray-500 uppercase flex items-center justify-center gap-1"><Wallet className="h-3.5 w-3.5 text-blue-600" /> Saldo Atual</p>
            <p className="text-lg font-bold text-blue-700 mt-1">{fmt(resumo.saldo_atual)}</p>
          </div>
        </div>
      )}

      {/* Contas Bancárias */}
      {contas.length > 0 && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Contas Bancarias</h3>
          <div className="flex flex-wrap gap-3">
            {contas.map(c => (
              <button key={c.id} type="button" onClick={() => { setAccountId(accountId === c.id ? '' : c.id); setPage(1) }}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-all',
                  accountId === c.id ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                )}>
                <div className="flex items-center gap-2">
                  <div className={cn('h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white', accountId === c.id ? 'bg-blue-600' : 'bg-gray-400')}>
                    {(c.bank_name || c.name).substring(0, 2).toUpperCase()}
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-xs">{c.bank_name || c.name}</p>
                    <p className="font-bold">{fmt(c.current_balance ?? 0)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">De</label>
            <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1) }}
              className="rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Ate</label>
            <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1) }}
              className="rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Buscar lancamento, cliente..." className="w-full rounded-md border pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
          </div>
          <button type="button" onClick={() => setShowFilters(!showFilters)}
            className={cn('flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm', showFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'text-gray-600')}>
            <Filter className="h-4 w-4" /> Filtros {hasFilters && <span className="bg-blue-600 text-white rounded-full h-4 w-4 text-[10px] flex items-center justify-center">!</span>}
          </button>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">
              <X className="h-3.5 w-3.5" /> Limpar
            </button>
          )}
        </div>

        {/* Filtros avançados */}
        {showFilters && (
          <div className="mt-3 pt-3 border-t flex flex-wrap gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Categoria</label>
              <select title="Categoria" value={categoryId} onChange={e => { setCategoryId(e.target.value); setPage(1) }}
                className="rounded-md border px-3 py-2 text-sm min-w-[180px]">
                <option value="">Todas</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Centro de Custo</label>
              <select title="Centro de Custo" value={costCenterId} onChange={e => { setCostCenterId(e.target.value); setPage(1) }}
                className="rounded-md border px-3 py-2 text-sm min-w-[180px]">
                <option value="">Todos</option>
                {centrosCusto.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Lancamento</th>
              <th className="px-4 py-3">Conta Bancaria</th>
              <th className="px-4 py-3">Centro Custo</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3 text-right">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Carregando...
              </td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                Nenhum lancamento no periodo
              </td></tr>
            ) : items.map(item => (
              <tr key={`${item.origem}-${item.id}`} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{safeDate(item.data)}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{item.descricao}</p>
                  {item.entidade !== '—' && <p className="text-xs text-gray-500">{item.entidade}</p>}
                </td>
                <td className="px-4 py-3 text-gray-500">{item.conta_bancaria}</td>
                <td className="px-4 py-3 text-gray-500">{item.centro_custo}</td>
                <td className="px-4 py-3 text-gray-500">{item.categoria}</td>
                <td className={cn('px-4 py-3 text-right font-semibold whitespace-nowrap', item.tipo === 'ENTRADA' ? 'text-green-600' : 'text-red-600')}>
                  {item.tipo === 'ENTRADA' ? '+ ' : '- '}{fmt(item.valor)}
                </td>
              </tr>
            ))}
          </tbody>
          {/* Totais */}
          {!loading && items.length > 0 && resumo && (
            <tfoot>
              <tr className="border-t-2 bg-gray-50 font-semibold">
                <td colSpan={5} className="px-4 py-3 text-right text-gray-700">{total} lancamento(s)</td>
                <td className="px-4 py-3 text-right">
                  <span className="text-green-600">+{fmt(resumo.entradas)}</span>
                  <span className="mx-1 text-gray-300">|</span>
                  <span className="text-red-600">-{fmt(resumo.saidas)}</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Pagina {page} de {totalPages} ({total} registros)</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50">Anterior</button>
            <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50">Proxima</button>
          </div>
        </div>
      )}
    </div>
  )
}
