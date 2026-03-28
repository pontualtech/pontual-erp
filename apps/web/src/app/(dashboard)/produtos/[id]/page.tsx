'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Pencil, Trash2, Package, Wrench, AlertTriangle } from 'lucide-react'

interface Produto {
  id: string; name: string; description: string | null; barcode: string | null
  internal_code: string | null; brand: string | null; unit: string
  cost_price: number; sale_price: number; current_stock: number
  min_stock: number; max_stock: number; is_active: boolean
  categories: { id: string; name: string } | null; created_at: string
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function ProdutoDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [produto, setProduto] = useState<Produto | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetch(`/api/produtos/${id}`)
      .then(r => r.json())
      .then(d => setProduto(d.data ?? null))
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }, [id])

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/produtos/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Produto excluído'); router.push('/produtos')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setDeleting(false) }
  }

  if (loading) return <div className="py-12 text-center text-gray-400">Carregando...</div>
  if (!produto) return <div className="py-12 text-center text-red-500">Produto não encontrado</div>

  const isServico = produto.unit === 'SV'
  const baixo = !isServico && produto.current_stock <= produto.min_stock && produto.min_stock > 0

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/produtos" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{produto.name}</h1>
              {isServico ? (
                <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  <Wrench className="h-3 w-3" /> Serviço
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  <Package className="h-3 w-3" /> Produto
                </span>
              )}
            </div>
            {produto.brand && <p className="text-sm text-gray-500">{produto.brand}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/produtos/${id}/editar`}
            className="flex items-center gap-2 px-4 py-2 text-sm border rounded-md hover:bg-gray-50 font-medium">
            <Pencil className="h-4 w-4" /> Editar
          </Link>
          <button type="button" onClick={() => setShowDelete(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-red-200 rounded-md hover:bg-red-50 text-red-600 font-medium">
            <Trash2 className="h-4 w-4" /> Excluir
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-white p-5 space-y-2">
          <h2 className="font-semibold text-gray-900">Informações</h2>
          <Row label="Nome" value={produto.name} />
          {produto.description && <Row label="Descrição" value={produto.description} />}
          {produto.barcode && <Row label="Código de Barras" value={produto.barcode} />}
          {produto.internal_code && <Row label="Código Interno" value={produto.internal_code} />}
          <Row label="Marca" value={produto.brand || '—'} />
          <Row label="Unidade" value={isServico ? 'Serviço' : produto.unit} />
          {produto.categories && <Row label="Categoria" value={produto.categories.name} />}
          <Row label="Status" value={produto.is_active ? 'Ativo' : 'Inativo'} />
          <Row label="Cadastrado em" value={new Date(produto.created_at).toLocaleDateString('pt-BR')} />
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-5 space-y-2">
            <h2 className="font-semibold text-gray-900">Preços</h2>
            <Row label={isServico ? 'Custo' : 'Preço de Custo'} value={fmt(produto.cost_price)} />
            <Row label={isServico ? 'Valor Cobrado' : 'Preço de Venda'} value={fmt(produto.sale_price)} />
            {produto.cost_price > 0 && (
              <Row label="Margem" value={`${(((produto.sale_price - produto.cost_price) / produto.cost_price) * 100).toFixed(1)}%`} />
            )}
          </div>

          {!isServico && (
            <div className="rounded-lg border bg-white p-5 space-y-2">
              <h2 className="font-semibold text-gray-900">Estoque</h2>
              <div className="flex items-center gap-2">
                <span className={`text-2xl font-bold ${baixo ? 'text-red-600' : 'text-gray-900'}`}>
                  {produto.current_stock} {produto.unit}
                </span>
                {baixo && <AlertTriangle className="h-5 w-5 text-red-500" />}
              </div>
              <Row label="Mínimo" value={String(produto.min_stock)} />
              <Row label="Máximo" value={String(produto.max_stock)} />
              {baixo && <p className="text-xs text-red-600 font-medium">Estoque abaixo do mínimo!</p>}
            </div>
          )}
        </div>
      </div>

      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDelete(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-2">Excluir {isServico ? 'serviço' : 'produto'}?</h2>
            <p className="text-sm text-gray-600 mb-4">Tem certeza que deseja excluir <strong>{produto.name}</strong>?</p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowDelete(false)} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  )
}
