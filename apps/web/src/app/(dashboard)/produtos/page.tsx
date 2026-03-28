'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Plus, Search, AlertTriangle, Package, Wrench, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/use-auth'

interface Produto {
  id: string
  name: string
  description: string | null
  barcode: string | null
  internal_code: string | null
  brand: string | null
  unit: string
  cost_price: number
  sale_price: number
  current_stock: number
  min_stock: number
  max_stock: number
  is_active: boolean
  categories: { id: string; name: string } | null
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function ProdutosPage() {
  const { isAdmin } = useAuth()
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [filtroTipo, setFiltroTipo] = useState<'' | 'produto' | 'servico'>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  function loadProdutos() {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (search) params.set('search', search)
    if (filtroTipo) params.set('type', filtroTipo)
    fetch(`/api/produtos?${params}`)
      .then(r => r.json())
      .then(d => {
        setProdutos(d.data ?? [])
        setTotalPages(d.totalPages ?? 1)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadProdutos(); setSelected(new Set()) }, [search, page, filtroTipo])

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    if (selected.size === produtos.length) setSelected(new Set())
    else setSelected(new Set(produtos.map(p => p.id)))
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    let ok = 0, fail = 0
    for (const id of selected) {
      try {
        const res = await fetch(`/api/produtos/${id}`, { method: 'DELETE' })
        if (res.ok) ok++; else fail++
      } catch { fail++ }
    }
    toast.success(`${ok} produto(s) excluído(s)${fail ? `, ${fail} erro(s)` : ''}`)
    setShowBulkDelete(false); setSelected(new Set()); setBulkDeleting(false); loadProdutos()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Produtos e Serviços</h1>
        <div className="flex items-center gap-2">
          {isAdmin && selected.size > 0 && (
            <button type="button" onClick={() => setShowBulkDelete(true)}
              className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
              <Trash2 className="h-4 w-4" /> Excluir {selected.size}
            </button>
          )}
          <Link
            href="/produtos/novo"
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Novo
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            placeholder="Buscar por nome, código de barras..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-1 rounded-md border bg-white p-0.5">
          <button type="button" onClick={() => { setFiltroTipo(''); setPage(1) }}
            className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${
              filtroTipo === '' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}>Todos</button>
          <button type="button" onClick={() => { setFiltroTipo('produto'); setPage(1) }}
            className={`px-3 py-1.5 text-sm rounded font-medium transition-colors flex items-center gap-1 ${
              filtroTipo === 'produto' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}><Package className="h-3.5 w-3.5" /> Produtos</button>
          <button type="button" onClick={() => { setFiltroTipo('servico'); setPage(1) }}
            className={`px-3 py-1.5 text-sm rounded font-medium transition-colors flex items-center gap-1 ${
              filtroTipo === 'servico' ? 'bg-amber-600 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}><Wrench className="h-3.5 w-3.5" /> Serviços</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              {isAdmin && (
                <th className="px-3 py-3 w-10">
                  <input type="checkbox" title="Selecionar todos"
                    checked={produtos.length > 0 && selected.size === produtos.length}
                    onChange={toggleAll} className="rounded text-blue-600" />
                </th>
              )}
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Estoque</th>
              <th className="px-4 py-3">Custo</th>
              <th className="px-4 py-3">Venda</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
            ) : produtos.length === 0 ? (
              <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-8 text-center text-gray-400">Nenhum item encontrado</td></tr>
            ) : (
              produtos.map(p => {
                const isServico = p.unit === 'SV'
                const baixo = !isServico && p.current_stock <= p.min_stock && p.min_stock > 0
                return (
                  <tr key={p.id} className={`hover:bg-gray-50 ${selected.has(p.id) ? 'bg-blue-50' : ''}`}>
                    {isAdmin && (
                      <td className="px-3 py-3">
                        <input type="checkbox" title={`Selecionar ${p.name}`}
                          checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)}
                          className="rounded text-blue-600" />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      {isServico ? (
                        <span className="flex items-center gap-1 text-amber-600">
                          <Wrench className="h-3.5 w-3.5" />
                          <span className="text-xs font-medium">Serviço</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-blue-600">
                          <Package className="h-3.5 w-3.5" />
                          <span className="text-xs font-medium">Produto</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/produtos/${p.id}`} className="font-medium text-blue-600 hover:underline">{p.name}</Link>
                      {p.brand && <span className="ml-1.5 text-xs text-gray-400">{p.brand}</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.barcode || p.internal_code || '—'}</td>
                    <td className="px-4 py-3">
                      {isServico ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <>
                          <span className={cn('flex items-center gap-1', baixo && 'text-red-600 font-medium')}>
                            {baixo && <AlertTriangle className="h-3.5 w-3.5" />}
                            {p.current_stock} {p.unit}
                          </span>
                          {baixo && <span className="text-xs text-gray-400">Mín: {p.min_stock}</span>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatCurrency(p.cost_price)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(p.sale_price)}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Selection bar */}
      {isAdmin && selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-2">
          <span className="text-sm text-blue-700 font-medium">{selected.size} selecionado(s)</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelected(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700">Limpar seleção</button>
            <button type="button" onClick={() => setShowBulkDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 font-medium">
              <Trash2 className="h-3.5 w-3.5" /> Excluir selecionados
            </button>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40">Anterior</button>
          <span className="text-sm text-gray-500">Página {page} de {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40">Próxima</button>
        </div>
      )}

      {/* Bulk delete modal */}
      {showBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowBulkDelete(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-red-600 mb-2">Excluir {selected.size} produtos?</h2>
            <p className="text-sm text-gray-600 mb-2">Esta ação não pode ser desfeita.</p>
            <p className="text-sm text-gray-500 mb-4">
              {produtos.filter(p => selected.has(p.id)).map(p => p.name).join(', ')}
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowBulkDelete(false)} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleBulkDelete} disabled={bulkDeleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
                {bulkDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {bulkDeleting ? 'Excluindo...' : `Excluir ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
