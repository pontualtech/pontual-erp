'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Plus, Search, AlertTriangle, Package, Wrench, Trash2, Loader2, ArrowRightLeft, PenLine, DollarSign, Download, Upload, ChevronDown, FileSpreadsheet, FileText, FileDown, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/use-auth'
import { exportToExcel, exportToCSV, exportToPDF, importFromFile } from '@/lib/export-data'

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

const exportColumns = [
  { key: 'name', label: 'Nome' },
  { key: 'brand', label: 'Marca' },
  { key: 'barcode', label: 'Codigo de Barras' },
  { key: 'internal_code', label: 'Codigo Interno' },
  { key: 'unit', label: 'Unidade' },
  { key: 'cost_price', label: 'Preco Custo', format: (v: number) => v ? (v/100).toFixed(2) : '' },
  { key: 'sale_price', label: 'Preco Venda', format: (v: number) => v ? (v/100).toFixed(2) : '' },
  { key: 'current_stock', label: 'Estoque Atual' },
  { key: 'min_stock', label: 'Estoque Minimo' },
  { key: 'category_name', label: 'Categoria' },
  { key: 'is_active', label: 'Ativo', format: (v: boolean) => v ? 'Sim' : 'Nao' },
]

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
  const [filtroAbaixoMinimo, setFiltroAbaixoMinimo] = useState(false)

  // Ajuste manual modal
  const [ajusteModal, setAjusteModal] = useState<Produto | null>(null)
  const [ajusteQtd, setAjusteQtd] = useState('')
  const [ajusteMotivo, setAjusteMotivo] = useState('')
  const [ajusteLoading, setAjusteLoading] = useState(false)

  // Export/Import
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importPreview, setImportPreview] = useState<{ headers: string[]; rows: Record<string, string>[]; filename: string } | null>(null)
  const [importing, setImporting] = useState(false)

  async function fetchAllProducts(): Promise<Produto[]> {
    const all: Produto[] = []
    let pg = 1
    let totalPgs = 1
    while (pg <= totalPgs) {
      const params = new URLSearchParams()
      params.set('page', String(pg))
      params.set('limit', '100')
      if (search) params.set('search', search)
      if (filtroTipo) params.set('type', filtroTipo)
      if (filtroAbaixoMinimo) params.set('below_min', '1')
      const res = await fetch(`/api/produtos?${params}`)
      const d = await res.json()
      all.push(...(d.data ?? []))
      totalPgs = d.totalPages ?? 1
      pg++
    }
    return all
  }

  function prepareExportData(data: Produto[]) {
    return data.map(p => ({
      ...p,
      category_name: p.categories?.name ?? '',
    }))
  }

  async function handleExport(format: 'excel' | 'csv' | 'pdf') {
    setShowExportMenu(false)
    setExporting(true)
    try {
      const allData = await fetchAllProducts()
      const data = prepareExportData(allData)
      const opts = { filename: 'produtos', title: 'Produtos e Servicos', columns: exportColumns, data }
      if (format === 'excel') exportToExcel(opts)
      else if (format === 'csv') exportToCSV(opts)
      else exportToPDF(opts)
      toast.success(`Exportado ${allData.length} produto(s) em ${format.toUpperCase()}`)
    } catch {
      toast.error('Erro ao exportar')
    } finally {
      setExporting(false)
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = await importFromFile(file)
      setImportPreview(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao ler arquivo')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleImportConfirm() {
    if (!importPreview) return
    setImporting(true)
    let ok = 0, fail = 0
    const total = importPreview.rows.length
    const toastId = toast.loading(`Importando 0/${total}...`)

    for (const row of importPreview.rows) {
      try {
        // Map headers to fields
        const name = row['Nome'] || row['name'] || row['NOME'] || ''
        if (!name.trim()) { fail++; continue }

        const brand = row['Marca'] || row['brand'] || row['MARCA'] || ''
        const barcode = row['Codigo de Barras'] || row['barcode'] || row['CODIGO DE BARRAS'] || ''
        const internal_code = row['Codigo Interno'] || row['internal_code'] || row['CODIGO INTERNO'] || ''
        const unitRaw = row['Unidade'] || row['unit'] || row['UNIDADE'] || ''
        const costRaw = row['Preco Custo'] || row['cost_price'] || row['PRECO CUSTO'] || '0'
        const saleRaw = row['Preco Venda'] || row['sale_price'] || row['PRECO VENDA'] || '0'

        // Determine unit
        const isService = unitRaw.toUpperCase() === 'SV' ||
          (row['Tipo'] || '').toLowerCase().includes('servico') ||
          (row['Tipo'] || '').toLowerCase().includes('serviço')
        const unit = isService ? 'SV' : (unitRaw || 'UN')

        // Convert price: accept "10,50" or "10.50" format, multiply by 100
        const parsePrice = (v: string) => {
          const cleaned = v.replace(/[R$\s]/g, '').replace(',', '.')
          return Math.round((parseFloat(cleaned) || 0) * 100)
        }

        const res = await fetch('/api/produtos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            brand: brand || undefined,
            barcode: barcode || undefined,
            internal_code: internal_code || undefined,
            unit,
            cost_price: parsePrice(costRaw),
            sale_price: parsePrice(saleRaw),
          }),
        })
        if (res.ok) ok++; else fail++
      } catch { fail++ }
      toast.loading(`Importando ${ok + fail}/${total}...`, { id: toastId })
    }

    toast.dismiss(toastId)
    toast.success(`Importacao concluida: ${ok} criado(s)${fail ? `, ${fail} erro(s)` : ''}`)
    setImportPreview(null)
    setImporting(false)
    loadProdutos()
  }

  function loadProdutos() {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (search) params.set('search', search)
    if (filtroTipo) params.set('type', filtroTipo)
    if (filtroAbaixoMinimo) params.set('below_min', '1')
    fetch(`/api/produtos?${params}`)
      .then(r => r.json())
      .then(d => {
        setProdutos(d.data ?? [])
        setTotalPages(d.totalPages ?? 1)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadProdutos(); setSelected(new Set()) }, [search, page, filtroTipo, filtroAbaixoMinimo])

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

  async function handleAjusteManual(e: React.FormEvent) {
    e.preventDefault()
    if (!ajusteModal || !ajusteQtd) return
    setAjusteLoading(true)
    try {
      const res = await fetch('/api/estoque/movimentar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: ajusteModal.id,
          movement_type: 'ADJUSTMENT',
          quantity: parseInt(ajusteQtd, 10),
          reason: 'AJUSTE',
          notes: ajusteMotivo || 'Ajuste manual de estoque',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao ajustar estoque')
      toast.success('Estoque ajustado com sucesso!')
      setAjusteModal(null); setAjusteQtd(''); setAjusteMotivo('')
      loadProdutos()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao ajustar')
    } finally {
      setAjusteLoading(false)
    }
  }

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return
    const handler = () => setShowExportMenu(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showExportMenu])

  // Computed values
  const produtosAbaixoMin = produtos.filter(p => p.unit !== 'SV' && p.min_stock > 0 && p.current_stock <= p.min_stock)
  const custoTotalEstoque = produtos
    .filter(p => p.unit !== 'SV')
    .reduce((acc, p) => acc + (p.current_stock * p.cost_price), 0)

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
          {/* Import button */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.txt"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Upload className="h-4 w-4" /> Importar
          </button>
          {/* Export dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowExportMenu(!showExportMenu) }}
              disabled={exporting}
              className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exportar
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border bg-white py-1 shadow-lg">
                <button type="button" onClick={() => handleExport('excel')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                  <FileSpreadsheet className="h-4 w-4 text-green-600" /> Excel (.xlsx)
                </button>
                <button type="button" onClick={() => handleExport('csv')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                  <FileText className="h-4 w-4 text-blue-600" /> CSV (.csv)
                </button>
                <button type="button" onClick={() => handleExport('pdf')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                  <FileDown className="h-4 w-4 text-red-600" /> PDF (.pdf)
                </button>
              </div>
            )}
          </div>
          <Link
            href="/produtos/novo"
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Novo
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Custo Total em Estoque */}
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Custo Total em Estoque</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{loading ? '...' : formatCurrency(custoTotalEstoque)}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2.5">
              <DollarSign className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
        </div>
        {/* Produtos Abaixo do Minimo */}
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Abaixo do Mínimo</p>
              <p className="mt-1 text-xl font-bold text-red-600">{loading ? '...' : produtosAbaixoMin.length}</p>
            </div>
            <div className="rounded-lg bg-red-50 p-2.5">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
          </div>
        </div>
        {/* Total de Itens */}
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total de Itens</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{loading ? '...' : produtos.length}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-2.5">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Alertas de Estoque */}
      {!loading && produtosAbaixoMin.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <h3 className="font-semibold text-yellow-800">Alertas de Estoque</h3>
          </div>
          <div className="space-y-1">
            {produtosAbaixoMin.slice(0, 5).map(p => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <Link href={`/produtos/${p.id}`} className="text-yellow-900 hover:underline font-medium">{p.name}</Link>
                <span className="text-yellow-700">
                  {p.current_stock} / {p.min_stock} {p.unit} — faltam {p.min_stock - p.current_stock}
                </span>
              </div>
            ))}
            {produtosAbaixoMin.length > 5 && (
              <p className="text-xs text-yellow-600 mt-1">
                + {produtosAbaixoMin.length - 5} outros produtos abaixo do mínimo
              </p>
            )}
          </div>
        </div>
      )}

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
        {/* Toggle abaixo do minimo */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filtroAbaixoMinimo}
            onChange={e => { setFiltroAbaixoMinimo(e.target.checked); setPage(1) }}
            className="rounded text-red-600 focus:ring-red-500"
          />
          <span className={cn('text-sm font-medium', filtroAbaixoMinimo ? 'text-red-600' : 'text-gray-500')}>
            Abaixo do mínimo
          </span>
        </label>
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
              <th className="px-4 py-3">Estoque Atual</th>
              <th className="px-4 py-3">Estoque Mín</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Custo</th>
              <th className="px-4 py-3">Venda</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={isAdmin ? 10 : 9} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
            ) : produtos.length === 0 ? (
              <tr><td colSpan={isAdmin ? 10 : 9} className="px-4 py-8 text-center text-gray-400">Nenhum item encontrado</td></tr>
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
                        <span className="font-medium text-gray-900">{p.current_stock} {p.unit}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {isServico ? '—' : p.min_stock}
                    </td>
                    <td className="px-4 py-3">
                      {isServico ? (
                        <span className="text-gray-400">—</span>
                      ) : p.current_stock === 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          <AlertTriangle className="h-3 w-3" /> Zerado
                        </span>
                      ) : p.current_stock <= p.min_stock ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                          <AlertTriangle className="h-3 w-3" /> Baixo
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          OK
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatCurrency(p.cost_price)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(p.sale_price)}</td>
                    <td className="px-4 py-3">
                      {!isServico && (
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/produtos/${p.id}/movimentacoes`}
                            title="Movimentações"
                            className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                          >
                            <ArrowRightLeft className="h-4 w-4" />
                          </Link>
                          <button
                            type="button"
                            title="Ajuste Manual"
                            onClick={() => { setAjusteModal(p); setAjusteQtd(''); setAjusteMotivo('') }}
                            className="rounded p-1 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                          >
                            <PenLine className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
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

      {/* Ajuste Manual modal */}
      {ajusteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAjusteModal(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Ajuste Manual de Estoque</h2>
            <p className="text-sm text-gray-500 mb-4">
              {ajusteModal.name} — Estoque atual: <span className="font-medium">{ajusteModal.current_stock} {ajusteModal.unit}</span>
            </p>
            <form onSubmit={handleAjusteManual} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Nova Quantidade *</label>
                <input
                  type="number"
                  value={ajusteQtd}
                  onChange={e => setAjusteQtd(e.target.value)}
                  placeholder="Ex: 50"
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">
                  Informe a quantidade do ajuste (positivo para entrada, negativo para saída)
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Motivo</label>
                <input
                  type="text"
                  value={ajusteMotivo}
                  onChange={e => setAjusteMotivo(e.target.value)}
                  placeholder="Ex: Contagem de inventário"
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setAjusteModal(null)}
                  className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={ajusteLoading || !ajusteQtd}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium">
                  {ajusteLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {ajusteLoading ? 'Salvando...' : 'Confirmar Ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Preview modal */}
      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !importing && setImportPreview(null)}>
          <div className="w-full max-w-3xl rounded-lg bg-white p-6 shadow-xl max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Importar Produtos</h2>
                <p className="text-sm text-gray-500">
                  Arquivo: {importPreview.filename} — {importPreview.rows.length} linha(s)
                </p>
              </div>
              {!importing && (
                <button type="button" title="Fechar" onClick={() => setImportPreview(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Pre-visualizacao (primeiras 5 linhas)</h3>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      {importPreview.headers.map(h => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {importPreview.rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        {importPreview.headers.map(h => (
                          <td key={h} className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{row[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importPreview.rows.length > 5 && (
                <p className="text-xs text-gray-400 mt-1">+ {importPreview.rows.length - 5} linhas adicionais</p>
              )}
            </div>

            <div className="rounded-md bg-blue-50 border border-blue-200 p-3 mb-4">
              <p className="text-xs text-blue-700">
                <strong>Mapeamento esperado:</strong> Nome (obrigatorio), Marca, Codigo de Barras, Codigo Interno, Unidade (SV=servico, UN=produto), Preco Custo, Preco Venda.
                Precos devem estar em reais (ex: 10,50). Serao convertidos automaticamente.
              </p>
            </div>

            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setImportPreview(null)} disabled={importing}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={handleImportConfirm} disabled={importing}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium">
                {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {importing ? 'Importando...' : `Importar ${importPreview.rows.length} produto(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
