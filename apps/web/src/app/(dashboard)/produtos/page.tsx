'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Plus, Search, AlertTriangle } from 'lucide-react'

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
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (search) params.set('search', search)
    fetch(`/api/produtos?${params}`)
      .then(r => r.json())
      .then(d => {
        setProdutos(d.data ?? [])
        setTotalPages(d.totalPages ?? 1)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [search, page])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Produtos</h1>
        <Link
          href="/produtos/novo"
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Novo Produto
        </Link>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input
          placeholder="Buscar por nome, codigo de barras..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Codigo</th>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Estoque</th>
              <th className="px-4 py-3">Custo</th>
              <th className="px-4 py-3">Venda</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
            ) : produtos.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum produto encontrado</td></tr>
            ) : (
              produtos.map(p => {
                const baixo = p.current_stock <= p.min_stock
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.barcode || p.internal_code || '—'}</td>
                    <td className="px-4 py-3">
                      <Link href={`/produtos/${p.id}`} className="font-medium text-blue-600 hover:underline">{p.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{p.categories?.name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('flex items-center gap-1', baixo && 'text-red-600 font-medium')}>
                        {baixo && <AlertTriangle className="h-3.5 w-3.5" />}
                        {p.current_stock} {p.unit}
                      </span>
                      {baixo && <span className="text-xs text-gray-400">Min: {p.min_stock}</span>}
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-sm text-gray-500">Pagina {page} de {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Proxima
          </button>
        </div>
      )}
    </div>
  )
}
