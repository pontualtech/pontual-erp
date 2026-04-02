'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn, formatDocument } from '@/lib/utils'
import {
  ArrowLeft, Send, Loader2, Plus, Trash2, Search,
  CheckCircle2, XCircle, AlertTriangle, Download, FileText,
  ShoppingCart, Wrench, RotateCcw, Package, Home,
  DollarSign, CreditCard, Banknote, QrCode, Receipt,
  ChevronDown, Info,
} from 'lucide-react'
import { toast } from 'sonner'

// ---------- Types ----------

interface Cliente {
  id: string
  legal_name: string
  document_number: string | null
  person_type: string
  address_street: string | null
  address_number: string | null
  address_complement: string | null
  address_neighborhood: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  state_registration: string | null
  email: string | null
}

interface Produto {
  id: string
  name: string
  internal_code: string | null
  barcode: string | null
  ncm: string | null
  cfop: string | null
  unit: string | null
  sale_price: number | null
}

interface ItemForm {
  key: number
  product_id: string
  descricao: string
  quantidade: number
  valor_unitario_display: string
  valor_unitario: number // centavos para API antiga, reais para nfe-emitir
  ncm: string
  cfop: string
  unidade: string
  codigo_produto: string
}

interface SefazStatus {
  online: boolean
  tempo_medio?: string
}

interface EmissionResult {
  id: string
  numero: number
  serie: string
  chave_acesso: string
  status: string
  protocolo: string
  motivo: string
}

// ---------- Constants ----------

const NATUREZAS = [
  { value: 'VENDA DE MERCADORIA', label: 'Venda de Mercadoria', icon: ShoppingCart, cfop: '5102', color: 'border-blue-200 bg-blue-50' },
  { value: 'DEVOLUCAO DE MERCADORIA', label: 'Devolucao de Mercadoria', icon: RotateCcw, cfop: '5202', color: 'border-red-200 bg-red-50' },
  { value: 'REMESSA PARA CONSERTO', label: 'Remessa para Conserto', icon: Wrench, cfop: '5915', color: 'border-orange-200 bg-orange-50' },
  { value: 'RETORNO DE CONSERTO', label: 'Retorno de Conserto', icon: Package, cfop: '5916', color: 'border-green-200 bg-green-50' },
  { value: 'REMESSA EM GARANTIA', label: 'Remessa em Garantia', icon: Package, cfop: '5949', color: 'border-purple-200 bg-purple-50' },
  { value: 'OUTRAS SAIDAS', label: 'Outras Saidas', icon: FileText, cfop: '5949', color: 'border-gray-200 bg-gray-50' },
]

const PAGAMENTOS = [
  { value: '17', label: 'PIX', icon: QrCode },
  { value: '01', label: 'Dinheiro', icon: Banknote },
  { value: '03', label: 'Cartao Credito', icon: CreditCard },
  { value: '04', label: 'Cartao Debito', icon: CreditCard },
  { value: '15', label: 'Boleto Bancario', icon: Receipt },
  { value: '99', label: 'Outros', icon: DollarSign },
]

// ---------- Helpers ----------

function formatCurrency(reais: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(reais)
}

function parseCurrencyInput(value: string): number {
  const cleaned = value.replace(/[^\d.,]/g, '')
  const normalized = cleaned.replace(',', '.')
  const parsed = parseFloat(normalized)
  if (isNaN(parsed)) return 0
  return parsed
}

let itemKeyCounter = 0
function createEmptyItem(): ItemForm {
  return {
    key: ++itemKeyCounter,
    product_id: '',
    descricao: '',
    quantidade: 1,
    valor_unitario_display: '',
    valor_unitario: 0,
    ncm: '',
    cfop: '',
    unidade: 'UN',
    codigo_produto: '',
  }
}

// ---------- Component ----------

export default function EmitirNfePage() {
  const router = useRouter()

  // SEFAZ Status
  const [sefazStatus, setSefazStatus] = useState<SefazStatus | null>(null)
  const [sefazLoading, setSefazLoading] = useState(true)

  // Form state
  const [natureza, setNatureza] = useState(NATUREZAS[0].value)
  const [formaPagamento, setFormaPagamento] = useState('17')
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null)
  const [clienteSearch, setClienteSearch] = useState('')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)
  const clienteRef = useRef<HTMLDivElement>(null)

  // Items
  const [items, setItems] = useState<ItemForm[]>([createEmptyItem()])
  const [produtoSearches, setProdutoSearches] = useState<Record<number, string>>({})
  const [produtoResults, setProdutoResults] = useState<Record<number, Produto[]>>({})
  const [showProdutoDropdown, setShowProdutoDropdown] = useState<number | null>(null)

  // Additional fields
  const [infoAdicionais, setInfoAdicionais] = useState('')
  const [chavesReferenciadas, setChavesReferenciadas] = useState<string[]>([])
  const [novaChaveRef, setNovaChaveRef] = useState('')

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<EmissionResult | null>(null)
  const [resultError, setResultError] = useState<string | null>(null)

  // ---------- SEFAZ Status ----------

  useEffect(() => {
    fetch('/api/fiscal/nfe-status')
      .then(r => r.json())
      .then(d => setSefazStatus(d.data ?? { online: true }))
      .catch(() => setSefazStatus({ online: true }))
      .finally(() => setSefazLoading(false))
  }, [])

  // ---------- Cliente search ----------

  useEffect(() => {
    if (clienteSearch.length < 2) { setClientes([]); return }
    const timer = setTimeout(() => {
      fetch(`/api/clientes?search=${encodeURIComponent(clienteSearch)}&limit=10`)
        .then(r => r.json())
        .then(d => {
          setClientes(d.data ?? [])
          setShowClienteDropdown(true)
        })
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [clienteSearch])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (clienteRef.current && !clienteRef.current.contains(e.target as Node)) {
        setShowClienteDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function selectCliente(c: Cliente) {
    setSelectedCliente(c)
    setClienteSearch(c.legal_name)
    setShowClienteDropdown(false)
  }

  // ---------- Produto search per item ----------

  function handleProdutoSearch(itemKey: number, search: string) {
    setProdutoSearches(prev => ({ ...prev, [itemKey]: search }))
    if (search.length < 2) {
      setProdutoResults(prev => ({ ...prev, [itemKey]: [] }))
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/produtos?search=${encodeURIComponent(search)}&limit=8`)
        .then(r => r.json())
        .then(d => {
          setProdutoResults(prev => ({ ...prev, [itemKey]: d.data ?? [] }))
          setShowProdutoDropdown(itemKey)
        })
        .catch(() => {})
    }, 300)
    // Can't use cleanup in non-effect, but quick enough
  }

  function selectProduto(produto: Produto, itemIndex: number) {
    const selectedNat = NATUREZAS.find(n => n.value === natureza)
    setItems(prev => prev.map((item, i) => {
      if (i !== itemIndex) return item
      const priceReais = produto.sale_price ? produto.sale_price / 100 : 0
      return {
        ...item,
        product_id: produto.id,
        descricao: produto.name,
        ncm: produto.ncm || '',
        cfop: produto.cfop || selectedNat?.cfop || '5102',
        unidade: produto.unit || 'UN',
        codigo_produto: produto.internal_code || produto.barcode || '',
        valor_unitario: priceReais,
        valor_unitario_display: priceReais ? priceReais.toFixed(2).replace('.', ',') : '',
      }
    }))
    setShowProdutoDropdown(null)
    setProdutoSearches(prev => ({ ...prev, [items[itemIndex].key]: '' }))
  }

  function updateItem(index: number, field: keyof ItemForm, value: any) {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item
      if (field === 'valor_unitario_display') {
        return { ...item, valor_unitario_display: value, valor_unitario: parseCurrencyInput(value) }
      }
      return { ...item, [field]: value }
    }))
  }

  function addItem() {
    setItems(prev => [...prev, createEmptyItem()])
  }

  function removeItem(index: number) {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  // ---------- Referenced keys ----------

  function addChaveRef() {
    const chave = novaChaveRef.replace(/\D/g, '')
    if (chave.length !== 44) {
      toast.error('Chave NF-e deve ter exatamente 44 digitos')
      return
    }
    if (chavesReferenciadas.includes(chave)) {
      toast.error('Chave ja adicionada')
      return
    }
    setChavesReferenciadas(prev => [...prev, chave])
    setNovaChaveRef('')
  }

  // ---------- Totals ----------

  const totalReais = items.reduce((sum, i) => sum + (i.valor_unitario * i.quantidade), 0)

  const selectedNat = NATUREZAS.find(n => n.value === natureza)
  const needsRef = natureza.includes('DEVOLUCAO') || natureza.includes('RETORNO')

  const canSubmit =
    selectedCliente &&
    items.every(i => i.descricao.trim() && i.valor_unitario > 0 && i.quantidade > 0) &&
    (!needsRef || chavesReferenciadas.length > 0)

  // ---------- Submit ----------

  async function handleSubmit() {
    if (!canSubmit || !selectedCliente) return
    setSubmitting(true)
    setResultError(null)
    setResult(null)

    try {
      const payload = {
        customer_id: selectedCliente.id,
        natureza_operacao: natureza,
        tipo_operacao: '1', // saida
        finalidade: natureza.includes('DEVOLUCAO') ? '4' : '1',
        items: items.map(item => ({
          product_id: item.product_id || undefined,
          descricao: item.descricao,
          quantidade: item.quantidade,
          valor_unitario: item.valor_unitario,
          ncm: item.ncm || undefined,
          cfop: item.cfop || selectedNat?.cfop || '5102',
          unidade: item.unidade || 'UN',
          codigo_produto: item.codigo_produto || undefined,
        })),
        pagamentos: [
          { forma: formaPagamento, valor: totalReais },
        ],
        informacoes_adicionais: infoAdicionais || undefined,
        chaves_referenciadas: chavesReferenciadas.length > 0 ? chavesReferenciadas : undefined,
      }

      const res = await fetch('/api/fiscal/nfe-emitir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        setResultError(data.error || 'Erro ao emitir NF-e')
        toast.error(data.error || 'Erro ao emitir NF-e')
        return
      }

      setResult(data.data)
      if (data.data?.status === 'AUTHORIZED') {
        toast.success(`NF-e #${data.data.numero} autorizada com sucesso!`)
      } else if (data.data?.status === 'PROCESSING') {
        toast.info('NF-e enviada para processamento na SEFAZ')
      } else {
        toast.error(`NF-e rejeitada: ${data.data?.motivo || 'Erro'}`)
      }
    } catch {
      setResultError('Erro de conexao com o servidor')
      toast.error('Erro de conexao')
    } finally {
      setSubmitting(false)
    }
  }

  // ---------- Render: Result ----------

  if (result) {
    const statusConfig: Record<string, { icon: any; color: string; bgColor: string; label: string }> = {
      AUTHORIZED: { icon: CheckCircle2, color: 'text-green-600', bgColor: 'bg-green-50 border-green-200', label: 'NF-e Autorizada' },
      PROCESSING: { icon: Loader2, color: 'text-yellow-600', bgColor: 'bg-yellow-50 border-yellow-200', label: 'NF-e em Processamento' },
      REJECTED: { icon: XCircle, color: 'text-red-600', bgColor: 'bg-red-50 border-red-200', label: 'NF-e Rejeitada' },
      ERROR: { icon: AlertTriangle, color: 'text-red-600', bgColor: 'bg-red-50 border-red-200', label: 'Erro na Emissao' },
    }
    const cfg = statusConfig[result.status] || statusConfig.PROCESSING
    const Icon = cfg.icon

    return (
      <div className="space-y-6 max-w-2xl">
        <nav className="flex items-center gap-1.5 text-sm text-gray-400">
          <Link href="/" className="hover:text-gray-600 flex items-center gap-1"><Home className="h-3.5 w-3.5" /> Inicio</Link>
          <span>/</span>
          <Link href="/fiscal" className="hover:text-gray-600">Fiscal</Link>
          <span>/</span>
          <Link href="/fiscal/nfe" className="hover:text-gray-600">NF-e</Link>
          <span>/</span>
          <span className="text-gray-700 font-medium">Resultado</span>
        </nav>

        <div className={cn('rounded-xl border p-6', cfg.bgColor)}>
          <div className="flex items-center gap-3 mb-4">
            <Icon className={cn('h-8 w-8', cfg.color, result.status === 'PROCESSING' && 'animate-spin')} />
            <div>
              <h2 className="text-xl font-bold text-gray-900">{cfg.label}</h2>
              <p className="text-sm text-gray-600">{result.motivo || 'Processamento concluido'}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-400">Numero / Serie</p>
              <p className="font-semibold">{result.numero} / {result.serie}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Protocolo</p>
              <p className="font-semibold font-mono text-xs">{result.protocolo || '---'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-gray-400">Chave de Acesso</p>
              <p className="font-mono text-xs break-all">{result.chave_acesso || '---'}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/fiscal/nfe"
            className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <ArrowLeft className="h-4 w-4" /> Voltar para Lista
          </Link>
          <button type="button"
            onClick={() => { setResult(null); setResultError(null); setSelectedCliente(null); setClienteSearch(''); setItems([createEmptyItem()]); setChavesReferenciadas([]); setInfoAdicionais('') }}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> Emitir Nova NF-e
          </button>
        </div>
      </div>
    )
  }

  // ---------- Render: Form ----------

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <Link href="/" className="hover:text-gray-600 flex items-center gap-1"><Home className="h-3.5 w-3.5" /> Inicio</Link>
        <span>/</span>
        <Link href="/fiscal" className="hover:text-gray-600">Fiscal</Link>
        <span>/</span>
        <Link href="/fiscal/nfe" className="hover:text-gray-600">NF-e</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Emitir</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/fiscal/nfe" className="rounded-lg border p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Emitir NF-e</h1>
            <p className="text-sm text-gray-500 mt-0.5">Nota Fiscal Eletronica de Produto (Modelo 55)</p>
          </div>
        </div>

        {/* SEFAZ Status */}
        <div className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
          sefazLoading ? 'border-gray-200 text-gray-400' :
          sefazStatus?.online ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'
        )}>
          {sefazLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <span className={cn('h-2.5 w-2.5 rounded-full', sefazStatus?.online ? 'bg-green-500' : 'bg-red-500')} />
          )}
          SEFAZ {sefazLoading ? '...' : sefazStatus?.online ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* Error banner */}
      {resultError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Erro na emissao</p>
            <p className="mt-0.5">{resultError}</p>
          </div>
          <button type="button" onClick={() => setResultError(null)} className="ml-auto text-red-500 hover:text-red-700">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Natureza da Operacao */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Natureza da Operacao</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {NATUREZAS.map(nat => {
            const Icon = nat.icon
            return (
              <button key={nat.value} type="button"
                onClick={() => {
                  setNatureza(nat.value)
                  // Update all items CFOP
                  setItems(prev => prev.map(item => ({ ...item, cfop: item.cfop || nat.cfop })))
                }}
                className={cn(
                  'flex items-center gap-2 rounded-lg border-2 p-3 text-left text-sm font-medium transition-all',
                  natureza === nat.value
                    ? `${nat.color} border-blue-500 ring-1 ring-blue-500`
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                )}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{nat.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Cliente */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Cliente / Destinatario</h2>

        <div ref={clienteRef} className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nome, CPF ou CNPJ..."
            aria-label="Buscar cliente"
            value={clienteSearch}
            onChange={e => { setClienteSearch(e.target.value); setSelectedCliente(null) }}
            onFocus={() => clientes.length > 0 && setShowClienteDropdown(true)}
            className="w-full rounded-lg border bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />

          {showClienteDropdown && clientes.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border bg-white shadow-lg max-h-60 overflow-y-auto">
              {clientes.map(c => (
                <button key={c.id} type="button"
                  onClick={() => selectCliente(c)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-blue-50 text-sm border-b last:border-b-0">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{c.legal_name}</p>
                    <p className="text-xs text-gray-400">{c.document_number ? formatDocument(c.document_number) : 'Sem CPF/CNPJ'}</p>
                  </div>
                  {c.address_city && (
                    <span className="text-xs text-gray-400 shrink-0">{c.address_city}/{c.address_state}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedCliente && (
          <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <p className="text-xs text-gray-400">Nome</p>
                <p className="font-medium">{selectedCliente.legal_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">CPF/CNPJ</p>
                <p className="font-medium">{formatDocument(selectedCliente.document_number)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Cidade/UF</p>
                <p className="font-medium">{selectedCliente.address_city || '---'}/{selectedCliente.address_state || '---'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Email</p>
                <p className="font-medium truncate">{selectedCliente.email || '---'}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Itens da NF-e</h2>
          <button type="button" onClick={addItem}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            <Plus className="h-4 w-4" /> Adicionar Item
          </button>
        </div>

        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={item.key} className="rounded-lg border bg-gray-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-500">Item {idx + 1}</span>
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(idx)}
                    className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Product search */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input type="text"
                  placeholder="Buscar produto no catalogo..."
                  aria-label={`Buscar produto para item ${idx + 1}`}
                  value={produtoSearches[item.key] || ''}
                  onChange={e => handleProdutoSearch(item.key, e.target.value)}
                  onFocus={() => (produtoResults[item.key]?.length ?? 0) > 0 && setShowProdutoDropdown(item.key)}
                  className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                />
                {showProdutoDropdown === item.key && (produtoResults[item.key]?.length ?? 0) > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-lg border bg-white shadow-lg max-h-48 overflow-y-auto">
                    {produtoResults[item.key].map(p => (
                      <button key={p.id} type="button" onClick={() => selectProduto(p, idx)}
                        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-blue-50 text-sm border-b last:border-b-0">
                        <div>
                          <p className="font-medium text-gray-900">{p.name}</p>
                          <p className="text-xs text-gray-400">{p.internal_code || p.barcode || '---'} | NCM: {p.ncm || '---'}</p>
                        </div>
                        {p.sale_price && (
                          <span className="text-sm font-medium text-green-600">{formatCurrency(p.sale_price / 100)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Item fields */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Descricao *</label>
                  <input type="text" value={item.descricao}
                    onChange={e => updateItem(idx, 'descricao', e.target.value)}
                    placeholder="Descricao do produto"
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Qtd *</label>
                  <input type="number" min={1} step={1} value={item.quantidade}
                    onChange={e => updateItem(idx, 'quantidade', Math.max(1, Number(e.target.value)))}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">V. Unitario (R$) *</label>
                  <input type="text" value={item.valor_unitario_display}
                    onChange={e => updateItem(idx, 'valor_unitario_display', e.target.value)}
                    placeholder="0,00"
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">NCM</label>
                  <input type="text" value={item.ncm}
                    onChange={e => updateItem(idx, 'ncm', e.target.value)}
                    placeholder="84433299"
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">CFOP</label>
                  <input type="text" value={item.cfop}
                    onChange={e => updateItem(idx, 'cfop', e.target.value)}
                    placeholder={selectedNat?.cfop || '5102'}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Unidade</label>
                  <select value={item.unidade} onChange={e => updateItem(idx, 'unidade', e.target.value)}
                    className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500">
                    <option value="UN">UN - Unidade</option>
                    <option value="PC">PC - Peca</option>
                    <option value="KG">KG - Quilograma</option>
                    <option value="MT">MT - Metro</option>
                    <option value="CX">CX - Caixa</option>
                    <option value="LT">LT - Litro</option>
                    <option value="HR">HR - Hora</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Cod. Produto</label>
                  <input type="text" value={item.codigo_produto}
                    onChange={e => updateItem(idx, 'codigo_produto', e.target.value)}
                    placeholder="Codigo interno"
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div className="flex items-end">
                  <div className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 w-full text-right">
                    {formatCurrency(item.valor_unitario * item.quantidade)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="mt-4 flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
          <span className="text-sm font-medium text-blue-800">Total da NF-e</span>
          <span className="text-xl font-bold text-blue-900">{formatCurrency(totalReais)}</span>
        </div>
      </div>

      {/* Payment */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Forma de Pagamento</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PAGAMENTOS.map(pag => {
            const Icon = pag.icon
            return (
              <button key={pag.value} type="button"
                onClick={() => setFormaPagamento(pag.value)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border-2 p-3 text-left text-sm font-medium transition-all',
                  formaPagamento === pag.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                )}>
                <Icon className="h-4 w-4 shrink-0" />
                {pag.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Referenced NF-e keys (for devolution/return) */}
      {needsRef && (
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Chaves NF-e Referenciadas</h2>
          <p className="text-xs text-gray-400 mb-3">Informe a(s) chave(s) da NF-e original (44 digitos)</p>

          <div className="flex items-center gap-2 mb-3">
            <input type="text" value={novaChaveRef}
              onChange={e => setNovaChaveRef(e.target.value)}
              placeholder="Chave de acesso da NF-e (44 digitos)"
              className="flex-1 rounded-md border px-3 py-2 text-sm font-mono outline-none focus:border-blue-500" />
            <button type="button" onClick={addChaveRef}
              className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {chavesReferenciadas.length > 0 ? (
            <div className="space-y-2">
              {chavesReferenciadas.map((chave, i) => (
                <div key={i} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
                  <span className="font-mono text-xs text-gray-700 truncate">{chave}</span>
                  <button type="button" onClick={() => setChavesReferenciadas(prev => prev.filter((_, idx) => idx !== i))}
                    className="ml-2 text-gray-400 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Pelo menos uma chave referenciada e obrigatoria para {natureza.toLowerCase()}
            </p>
          )}
        </div>
      )}

      {/* Additional Info */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Informacoes Adicionais</h2>
        <textarea
          rows={3}
          value={infoAdicionais}
          onChange={e => setInfoAdicionais(e.target.value)}
          placeholder="Informacoes complementares que serao impressas na DANFE (opcional)..."
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none"
        />
      </div>

      {/* Submit */}
      <div className="flex items-center justify-between rounded-xl border bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm text-gray-500">Total da NF-e</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalReais)}</p>
        </div>
        <button type="button" onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm">
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
          {submitting ? 'Emitindo...' : 'Emitir NF-e na SEFAZ'}
        </button>
      </div>
    </div>
  )
}
