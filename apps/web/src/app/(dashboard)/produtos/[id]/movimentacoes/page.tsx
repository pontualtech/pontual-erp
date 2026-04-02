'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowDownCircle, ArrowUpCircle, RefreshCw, Wrench, Package, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Product {
  id: string
  name: string
  current_stock: number
  min_stock: number
  max_stock: number
  unit: string
  cost_price: number
}

interface Movement {
  id: string
  movement_type: 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'OS_USAGE'
  quantity: number
  reference_type: string | null
  reference_id: string | null
  notes: string | null
  user_name: string | null
  created_at: string
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

const typeConfig: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  ENTRY: { label: 'Entrada', icon: ArrowDownCircle, color: 'text-green-600 bg-green-50' },
  EXIT: { label: 'Saída', icon: ArrowUpCircle, color: 'text-red-600 bg-red-50' },
  ADJUSTMENT: { label: 'Ajuste', icon: RefreshCw, color: 'text-amber-600 bg-amber-50' },
  OS_USAGE: { label: 'Uso em OS', icon: Wrench, color: 'text-purple-600 bg-purple-50' },
}

export default function MovimentacoesPage() {
  const params = useParams()
  const productId = params.id as string

  const [product, setProduct] = useState<Product | null>(null)
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/produtos/${productId}`).then(r => r.json()),
      fetch(`/api/products/${productId}/movements?page=${page}&limit=20`).then(r => r.json()),
    ])
      .then(([prodData, movData]) => {
        setProduct(prodData.data ?? prodData)
        setMovements(movData.data ?? [])
        setTotalPages(movData.totalPages ?? 1)
      })
      .catch(() => toast.error('Erro ao carregar movimentações'))
      .finally(() => setLoading(false))
  }, [productId, page])

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-3">
        <Link href="/produtos" className="rounded-lg p-2 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Movimentações</h1>
          <p className="text-sm text-gray-500">
            <Link href="/produtos" className="text-blue-600 hover:underline">Produtos</Link>
            {product && <> / {product.name}</>}
          </p>
        </div>
      </div>

      {/* Product Summary Card */}
      {product && (
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="rounded-lg bg-blue-50 p-3">
              <Package className="h-6 w-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900">{product.name}</h2>
              <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-500">
                <span>Estoque Atual: <span className="font-semibold text-gray-900">{product.current_stock} {product.unit}</span></span>
                <span>Mínimo: <span className="font-medium">{product.min_stock} {product.unit}</span></span>
                <span>Máximo: <span className="font-medium">{product.max_stock} {product.unit}</span></span>
                <span>Custo Médio: <span className="font-medium">{formatCurrency(product.cost_price)}</span></span>
              </div>
            </div>
            {product.current_stock <= product.min_stock && product.min_stock > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-700">
                Estoque Baixo
              </span>
            )}
          </div>
        </div>
      )}

      {/* Movements Table */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-5 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Histórico de Movimentações</h3>
          <Link
            href="/estoque/movimentar"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Nova Movimentação
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Quantidade</th>
                <th className="px-4 py-3">Referência</th>
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Observações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                    Carregando...
                  </td>
                </tr>
              ) : movements.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhuma movimentação encontrada</td></tr>
              ) : (
                movements.map(m => {
                  const cfg = typeConfig[m.movement_type] ?? typeConfig.ENTRY
                  const Icon = cfg.icon
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(m.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', cfg.color)}>
                          <Icon className="h-3 w-3" /> {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('font-semibold',
                          m.movement_type === 'ENTRY' ? 'text-green-600' :
                          m.movement_type === 'EXIT' || m.movement_type === 'OS_USAGE' ? 'text-red-600' :
                          'text-amber-600'
                        )}>
                          {m.movement_type === 'ENTRY' ? '+' : m.movement_type === 'EXIT' || m.movement_type === 'OS_USAGE' ? '-' : ''}
                          {m.quantity} {product?.unit ?? ''}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {m.reference_type && m.reference_id ? (
                          <Link href={m.reference_type === 'OS' ? `/os/${m.reference_id}` : '#'} className="text-blue-600 hover:underline text-xs">
                            {m.reference_type} #{m.reference_id.slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{m.user_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">{m.notes ?? '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40">Anterior</button>
          <span className="text-sm text-gray-500">Página {page} de {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40">Próxima</button>
        </div>
      )}
    </div>
  )
}
