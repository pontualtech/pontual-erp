'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn, formatDocument } from '@/lib/utils'
import {
  ArrowLeft, Send, Loader2, FileText, Search, Plus, Trash2,
  CheckCircle2, XCircle, Eye, AlertTriangle, Download, Package,
  Wrench, RotateCcw, ShoppingCart,
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

interface FiscalConfig {
  has_api_key: boolean
  environment: string | null
  settings: Record<string, any> | null
}

interface ItemForm {
  key: number
  product_id: string
  descricao: string
  quantidade: number
  valor_unitario_display: string
  valor_unitario_centavos: number
  ncm: string
  cfop: string
  unidade: string
  codigo_produto: string
}

type NfeTipo = 'venda' | 'remessa_conserto' | 'retorno_conserto' | 'devolucao'

interface EmissionResult {
  id: string
  status: string
  invoice_number: number | null
  access_key: string | null
  danfe_url: string | null
  xml_url: string | null
  provider_ref: string | null
  total_amount: number
  notes: string | null
}

// ---------- Helpers ----------

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function parseCurrencyInput(value: string): number {
  const cleaned = value.replace(/[^\d.,]/g, '')
  const normalized = cleaned.replace(',', '.')
  const parsed = parseFloat(normalized)
  if (isNaN(parsed)) return 0
  return Math.round(parsed * 100)
}

const TIPO_CONFIG: Record<NfeTipo, { label: string; icon: any; cfop: number; description: string; color: string }> = {
  venda: {
    label: 'Venda de Mercadoria',
    icon: ShoppingCart,
    cfop: 5102,
    description: 'Venda de produtos adquiridos ou recebidos de terceiros',
    color: 'border-blue-500 bg-blue-50 text-blue-700',
  },
  remessa_conserto: {
    label: 'Remessa p/ Conserto',
    icon: Wrench,
    cfop: 5915,
    description: 'Remessa de equipamento para conserto - ICMS suspenso',
    color: 'border-orange-500 bg-orange-50 text-orange-700',
  },
  retorno_conserto: {
    label: 'Retorno de Conserto',
    icon: RotateCcw,
    cfop: 5916,
    description: 'Retorno de mercadoria recebida para conserto - exige NF-e original',
    color: 'border-green-500 bg-green-50 text-green-700',
  },
  devolucao: {
    label: 'Devolucao',
    icon: Package,
    cfop: 5202,
    description: 'Devolucao de mercadoria adquirida - exige NF-e original',
    color: 'border-red-500 bg-red-50 text-red-700',
  },
}

let itemKeyCounter = 0

function createEmptyItem(): ItemForm {
  return {
    key: ++itemKeyCounter,
    product_id: '',
    descricao: '',
    quantidade: 1,
    valor_unitario_display: '',
    valor_unitario_centavos: 0,
    ncm: '',
    cfop: '',
    unidade: 'UN',
    codigo_produto: '',
  }
}

// ---------- Component ----------

export default function EmitirNfePage() {
  // Config
  const [config, setConfig] = useState<FiscalConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)

  // NF-e tipo
  const [tipo, setTipo] = useState<NfeTipo>('venda')

  // Customer search
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [clienteSearch, setClienteSearch] = useState('')
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null)
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)

  // Product search (for item addition)
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [produtoSearch, setProdutoSearch] = useState('')
  const [showProdutoDropdown, setShowProdutoDropdown] = useState(false)
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null)

  // Items
  const [items, setItems] = useState<ItemForm[]>([createEmptyItem()])

  // Notas referenciadas (retorno/devolucao)
  const [notasReferenciadas, setNotasReferenciadas] = useState<string[]>([])
  const [novaChaveRef, setNovaChaveRef] = useState('')

  // Info adicionais
  const [infoAdicionais, setInfoAdicionais] = useState('')

  // UI state
  const [showPreview, setShowPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [emissionResult, setEmissionResult] = useState<EmissionResult | null>(null)
  const [emissionError, setEmissionError] = useState<string | null>(null)

  // Load fiscal config
  useEffect(() => {
    fetch('/api/fiscal/config')
      .then(r => r.json())
      .then(d => setConfig(d.data ?? null))
      .catch(() => toast.error('Erro ao carregar configuracao fiscal'))
      .finally(() => setConfigLoading(false))
  }, [])

  // Search clients
  useEffect(() => {
    if (clienteSearch.length < 2) {
      setClientes([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/clientes?search=${encodeURIComponent(clienteSearch)}&limit=10`)
        .then(r => r.json())
        .then(d => setClientes(d.data ?? []))
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [clienteSearch])

  // Search products
  useEffect(() => {
    if (produtoSearch.length < 2) {
      setProdutos([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/produtos?search=${encodeURIComponent(produtoSearch)}&limit=10`)
        .then(r => r.json())
        .then(d => setProdutos(d.data ?? []))
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [produtoSearch])

  // ---------- Handlers ----------

  function selectCliente(c: Cliente) {
    setSelectedCliente(c)
    setClienteSearch(c.legal_name)
    setShowClienteDropdown(false)
  }

  function selectProduto(produto: Produto, itemIndex: number) {
    setItems(prev => prev.map((item, i) => {
      if (i !== itemIndex) return item
      return {
        ...item,
        product_id: produto.id,
        descricao: produto.name,
        ncm: produto.ncm || '',
        cfop: produto.cfop || String(TIPO_CONFIG[tipo].cfop),
        unidade: produto.unit || 'UN',
        codigo_produto: produto.internal_code || produto.barcode || '',
        valor_unitario_centavos: produto.sale_price || 0,
        valor_unitario_display: produto.sale_price ? (produto.sale_price / 100).toFixed(2).replace('.', ',') : '',
      }
    }))
    setProdutoSearch('')
    setShowProdutoDropdown(false)
    setEditingItemIndex(null)
  }

  function updateItem(index: number, field: keyof ItemForm, value: any) {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item
      if (field === 'valor_unitario_display') {
        return {
          ...item,
          valor_unitario_display: value,
          valor_unitario_centavos: parseCurrencyInput(value),
        }
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

  function addNotaReferenciada() {
    const chave = novaChaveRef.replace(/\D/g, '')
    if (chave.length !== 44) {
      toast.error('Chave NF-e deve ter exatamente 44 digitos')
      return
    }
    if (notasReferenciadas.includes(chave)) {
      toast.error('Chave ja adicionada')
      return
    }
    setNotasReferenciadas(prev => [...prev, chave])
    setNovaChaveRef('')
  }

  function removeNotaReferenciada(index: number) {
    setNotasReferenciadas(prev => prev.filter((_, i) => i !== index))
  }

  // Calculate totals
  const totalCentavos = items.reduce(
    (sum, i) => sum + (i.valor_unitario_centavos * i.quantidade), 0
  )

  const canSubmit =
    selectedCliente &&
    items.every(i => i.descricao.trim() && i.valor_unitario_centavos > 0 && i.quantidade > 0) &&
    (tipo !== 'retorno_conserto' || notasReferenciadas.length > 0) &&
    (tipo !== 'devolucao' || notasReferenciadas.length > 0)

  async function handleSubmit() {
    if (!canSubmit || !selectedCliente) return

    setSubmitting(true)
    setEmissionError(null)
    setEmissionResult(null)

    try {
      const payload = {
        tipo,
        customer_id: selectedCliente.id,
        items: items.map(item => ({
          product_id: item.product_id || undefined,
          descricao: item.descricao,
          quantidade: item.quantidade,
          valor_unitario: item.valor_unitario_centavos,
          cfop: item.cfop ? Number(item.cfop) : undefined,
          ncm: item.ncm || undefined,
          unidade: item.unidade || 'UN',
          codigo_produto: item.codigo_produto || undefined,
        })),
        notas_referenciadas: notasReferenciadas.length > 0 ? notasReferenciadas : undefined,
        informacoes_adicionais: infoAdicionais || undefined,
      }

      const res = await fetch('/api/fiscal/nfe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        setEmissionError(data.error || 'Erro ao emitir NF-e')
        toast.error(data.error || 'Erro ao emitir NF-e')
        return
      }

      setEmissionResult(data.data)
      setShowPreview(false)
      toast.success('NF-e enviada para processamento!')
    } catch {
      setEmissionError('Erro de conexao com o servidor')
      toast.error('Erro de conexao')
    } finally {
      setSubmitting(false)
    }
  }

  function resetForm() {
    setEmissionResult(null)
    setEmissionError(null)
    setSelectedCliente(null)
    setClienteSearch('')
    setItems([createEmptyItem()])
    setNotasReferenciadas([])
    setNovaChaveRef('')
    setInfoAdicionais('')
    setShowPreview(false)
  }

  // ---------- Render: Loading ----------

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  // ---------- Render: Result ----------

  if (emissionResult) {
    const statusMap: Record<string, { icon: any; color: string; label: string; desc: string }> = {
      AUTHORIZED: {
        icon: CheckCircle2,
        color: 'text-green-500',
        label: 'NF-e Autorizada',
        desc: emissionResult.invoice_number
          ? `Numero: ${emissionResult.invoice_number}`
          : `Ref: ${emissionResult.provider_ref}`,
      },
      PROCESSING: {
        icon: Loader2,
        color: 'text-yellow-500',
        label: 'NF-e em Processamento',
        desc: 'A SEFAZ esta processando sua NF-e. Acompanhe na lista de notas fiscais.',
      },
      REJECTED: {
        icon: XCircle,
        color: 'text-red-500',
        label: 'NF-e Rejeitada',
        desc: 'Verifique os dados e tente novamente.',
      },
    }

    const statusInfo = statusMap[emissionResult.status] || statusMap.PROCESSING
    const StatusIcon = statusInfo.icon

    return (
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/fiscal" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">NF-e Emitida</h1>
        </div>

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <StatusIcon className={cn('h-8 w-8', statusInfo.color, emissionResult.status === 'PROCESSING' && 'animate-spin')} />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{statusInfo.label}</h2>
              <p className="text-sm text-gray-500">{statusInfo.desc}</p>
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Tipo</span>
              <span className="font-medium">{emissionResult.notes || tipo}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Valor Total</span>
              <span className="font-medium">{formatCurrency(emissionResult.total_amount)}</span>
            </div>
            {emissionResult.access_key && (
              <div className="text-sm">
                <span className="text-gray-500">Chave NF-e:</span>
                <p className="font-mono text-xs mt-1 break-all">{emissionResult.access_key}</p>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {emissionResult.danfe_url && (
              <a
                href={emissionResult.danfe_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Eye className="h-4 w-4" /> Ver DANFE
              </a>
            )}
            {emissionResult.xml_url && (
              <a
                href={emissionResult.xml_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download className="h-4 w-4" /> Download XML
              </a>
            )}
            <Link
              href="/fiscal"
              className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Voltar para Fiscal
            </Link>
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Emitir Nova NF-e
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---------- Render: Form ----------

  const TipoIcon = TIPO_CONFIG[tipo].icon

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/fiscal" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Emitir NF-e</h1>
        </div>
        <p className="text-sm text-gray-500 ml-7">
          <Link href="/fiscal" className="text-blue-600 hover:underline">Fiscal</Link> / Emitir NF-e
        </p>
      </div>

      {/* Environment banner */}
      {config?.environment === 'homologacao' && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div>
            <strong>HOMOLOGACAO</strong> — Esta emissao sera feita em ambiente de testes. Nenhuma nota fiscal real sera gerada.
          </div>
        </div>
      )}

      {!config?.has_api_key && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2">
          <XCircle className="h-4 w-4 shrink-0" />
          <div>
            API Key do Focus NFe nao configurada.{' '}
            <Link href="/fiscal/config" className="font-medium underline">Configure aqui</Link>.
          </div>
        </div>
      )}

      {emissionError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {emissionError}
        </div>
      )}

      {/* 1. Tipo de NF-e */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Tipo de Operacao</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.entries(TIPO_CONFIG) as [NfeTipo, typeof TIPO_CONFIG.venda][]).map(([key, cfg]) => {
            const Icon = cfg.icon
            const isSelected = tipo === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTipo(key)
                  // Update CFOP on all items that use default
                  setItems(prev => prev.map(item => ({
                    ...item,
                    cfop: item.cfop === String(TIPO_CONFIG[tipo].cfop) || !item.cfop
                      ? String(cfg.cfop)
                      : item.cfop,
                  })))
                }}
                className={cn(
                  'relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-center transition-all',
                  isSelected
                    ? cfg.color + ' ring-2 ring-offset-1'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                )}
              >
                <Icon className="h-6 w-6" />
                <span className="text-sm font-medium">{cfg.label}</span>
                <span className="text-xs opacity-70">CFOP {cfg.cfop}</span>
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-sm text-gray-500">
          {TIPO_CONFIG[tipo].description}
        </p>
      </div>

      {/* 2. Customer */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Destinatario</h2>
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar cliente por nome ou documento..."
              value={clienteSearch}
              onChange={e => {
                setClienteSearch(e.target.value)
                setSelectedCliente(null)
                setShowClienteDropdown(true)
              }}
              onFocus={() => setShowClienteDropdown(true)}
              className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {showClienteDropdown && clientes.length > 0 && !selectedCliente && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg max-h-48 overflow-y-auto">
              {clientes.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCliente(c)}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-blue-50 flex justify-between items-center"
                >
                  <span className="font-medium text-gray-900">{c.legal_name}</span>
                  {c.document_number && (
                    <span className="text-xs text-gray-400">{formatDocument(c.document_number)}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedCliente && (
          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50/50 p-3">
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-gray-500">Nome:</span>{' '}
                <span className="font-medium">{selectedCliente.legal_name}</span>
              </div>
              <div>
                <span className="text-gray-500">Documento:</span>{' '}
                <span className="font-medium">{formatDocument(selectedCliente.document_number)}</span>
              </div>
              <div>
                <span className="text-gray-500">IE:</span>{' '}
                <span className="font-medium">{selectedCliente.state_registration || 'Isento'}</span>
              </div>
              <div>
                <span className="text-gray-500">Email:</span>{' '}
                <span className="font-medium">{selectedCliente.email || '---'}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-gray-500">Endereco:</span>{' '}
                <span className="font-medium">
                  {[
                    selectedCliente.address_street,
                    selectedCliente.address_number,
                    selectedCliente.address_complement,
                    selectedCliente.address_neighborhood,
                    selectedCliente.address_city,
                    selectedCliente.address_state,
                  ].filter(Boolean).join(', ') || '---'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setSelectedCliente(null); setClienteSearch('') }}
              className="mt-2 text-xs text-red-600 hover:underline"
            >
              Alterar cliente
            </button>
          </div>
        )}
      </div>

      {/* 3. Notas referenciadas (retorno/devolucao) */}
      {(tipo === 'retorno_conserto' || tipo === 'devolucao') && (
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-2">Notas Referenciadas</h2>
          <p className="text-sm text-gray-500 mb-4">
            Informe a(s) chave(s) da(s) NF-e original(is) de {tipo === 'retorno_conserto' ? 'remessa para conserto' : 'compra'}.
          </p>

          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="Chave NF-e (44 digitos)"
              value={novaChaveRef}
              onChange={e => setNovaChaveRef(e.target.value)}
              maxLength={50}
              className="flex-1 rounded-md border px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={addNotaReferenciada}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" /> Adicionar
            </button>
          </div>

          {notasReferenciadas.length > 0 ? (
            <div className="space-y-2">
              {notasReferenciadas.map((chave, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-md border bg-gray-50 px-3 py-2">
                  <span className="font-mono text-xs text-gray-700">{chave}</span>
                  <button
                    type="button"
                    title="Remover nota referenciada"
                    onClick={() => removeNotaReferenciada(idx)}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-amber-600">
              Obrigatorio: adicione ao menos uma chave NF-e referenciada.
            </p>
          )}
        </div>
      )}

      {/* 4. Items */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Itens da NF-e</h2>

        <div className="space-y-4">
          {items.map((item, idx) => (
            <div key={item.key} className="rounded-md border bg-gray-50/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">Item {idx + 1}</span>
                <button
                  type="button"
                  title="Remover item"
                  onClick={() => removeItem(idx)}
                  disabled={items.length <= 1}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Product search */}
              <div className="relative mb-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Produto (catalogo ou manual)</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Buscar produto no catalogo..."
                    value={editingItemIndex === idx ? produtoSearch : ''}
                    onChange={e => {
                      setEditingItemIndex(idx)
                      setProdutoSearch(e.target.value)
                      setShowProdutoDropdown(true)
                    }}
                    onFocus={() => {
                      setEditingItemIndex(idx)
                      setShowProdutoDropdown(true)
                    }}
                    className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                {showProdutoDropdown && editingItemIndex === idx && produtos.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg max-h-40 overflow-y-auto">
                    {produtos.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => selectProduto(p, idx)}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-blue-50 flex justify-between items-center"
                      >
                        <div>
                          <span className="font-medium text-gray-900">{p.name}</span>
                          {p.ncm && <span className="ml-2 text-xs text-gray-400">NCM: {p.ncm}</span>}
                        </div>
                        {p.sale_price != null && (
                          <span className="text-xs text-gray-500">{formatCurrency(p.sale_price)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Item fields */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="sm:col-span-5">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Descricao *</label>
                  <input
                    type="text"
                    required
                    placeholder="Descricao do produto"
                    value={item.descricao}
                    onChange={e => updateItem(idx, 'descricao', e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Qtd *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    step={1}
                    aria-label="Quantidade"
                    value={item.quantidade}
                    onChange={e => updateItem(idx, 'quantidade', Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Valor Unit. (R$) *</label>
                  <input
                    type="text"
                    required
                    placeholder="0,00"
                    value={item.valor_unitario_display}
                    onChange={e => updateItem(idx, 'valor_unitario_display', e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  {item.valor_unitario_centavos > 0 && (
                    <p className="mt-0.5 text-xs text-gray-400">{formatCurrency(item.valor_unitario_centavos)}</p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Subtotal</label>
                  <div className="rounded-md border bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700">
                    {formatCurrency(item.valor_unitario_centavos * item.quantidade)}
                  </div>
                </div>
              </div>

              {/* Fiscal fields */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 mt-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">NCM</label>
                  <input
                    type="text"
                    placeholder="84433299"
                    maxLength={8}
                    value={item.ncm}
                    onChange={e => updateItem(idx, 'ncm', e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">CFOP</label>
                  <input
                    type="text"
                    placeholder={String(TIPO_CONFIG[tipo].cfop)}
                    maxLength={4}
                    value={item.cfop}
                    onChange={e => updateItem(idx, 'cfop', e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Unidade</label>
                  <input
                    type="text"
                    placeholder="UN"
                    maxLength={6}
                    value={item.unidade}
                    onChange={e => updateItem(idx, 'unidade', e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Cod. Produto</label>
                  <input
                    type="text"
                    placeholder="Codigo interno"
                    value={item.codigo_produto}
                    onChange={e => updateItem(idx, 'codigo_produto', e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addItem}
          className="mt-4 flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <Plus className="h-4 w-4" /> Adicionar item
        </button>

        {/* Totals bar */}
        <div className="mt-4 flex items-center justify-between rounded-md border bg-gray-50 px-4 py-3">
          <div className="text-sm text-gray-500">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </div>
          <div className="text-lg font-bold text-gray-900">
            Total: {formatCurrency(totalCentavos)}
          </div>
        </div>
      </div>

      {/* 5. Informacoes adicionais */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Informacoes Adicionais (opcional)</h2>
        <textarea
          rows={3}
          placeholder="Informacoes complementares para o contribuinte..."
          value={infoAdicionais}
          onChange={e => setInfoAdicionais(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* 6. Preview / Submit */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          disabled={!canSubmit}
          className="flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <Eye className="h-4 w-4" />
          {showPreview ? 'Ocultar Preview' : 'Preview NF-e'}
        </button>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {submitting ? 'Emitindo...' : 'Emitir NF-e'}
        </button>
      </div>

      {/* Preview panel */}
      {showPreview && canSubmit && selectedCliente && (
        <div className="rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/30 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Preview da NF-e
          </h3>

          <div className="space-y-4 text-sm">
            {/* Tipo */}
            <div className="flex items-center gap-2">
              <TipoIcon className="h-4 w-4" />
              <span className="font-medium">{TIPO_CONFIG[tipo].label}</span>
              <span className="text-gray-400">CFOP {TIPO_CONFIG[tipo].cfop}</span>
            </div>

            {/* Destinatario */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium uppercase text-gray-400">Destinatario</p>
                <p className="font-medium">{selectedCliente.legal_name}</p>
                <p className="text-gray-500">{formatDocument(selectedCliente.document_number)}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-400">Endereco</p>
                <p className="text-gray-500">
                  {[
                    selectedCliente.address_street,
                    selectedCliente.address_number,
                    selectedCliente.address_neighborhood,
                    selectedCliente.address_city,
                    selectedCliente.address_state,
                  ].filter(Boolean).join(', ') || '---'}
                </p>
              </div>
            </div>

            {/* Items */}
            <div>
              <p className="text-xs font-medium uppercase text-gray-400 mb-2">Itens</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-gray-400">
                    <th className="pb-1">#</th>
                    <th className="pb-1">Descricao</th>
                    <th className="pb-1 text-right">Qtd</th>
                    <th className="pb-1 text-right">V.Unit.</th>
                    <th className="pb-1 text-right">Subtotal</th>
                    <th className="pb-1 text-right">NCM</th>
                    <th className="pb-1 text-right">CFOP</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.key} className="border-b border-dashed">
                      <td className="py-1">{idx + 1}</td>
                      <td className="py-1 font-medium">{item.descricao || '---'}</td>
                      <td className="py-1 text-right">{item.quantidade}</td>
                      <td className="py-1 text-right">{formatCurrency(item.valor_unitario_centavos)}</td>
                      <td className="py-1 text-right font-medium">
                        {formatCurrency(item.valor_unitario_centavos * item.quantidade)}
                      </td>
                      <td className="py-1 text-right text-gray-400">{item.ncm || '---'}</td>
                      <td className="py-1 text-right text-gray-400">{item.cfop || TIPO_CONFIG[tipo].cfop}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Notas referenciadas */}
            {notasReferenciadas.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase text-gray-400">Notas Referenciadas</p>
                {notasReferenciadas.map((chave, idx) => (
                  <p key={idx} className="font-mono text-xs text-gray-600">{chave}</p>
                ))}
              </div>
            )}

            {/* Info adicionais */}
            {infoAdicionais && (
              <div>
                <p className="text-xs font-medium uppercase text-gray-400">Informacoes Adicionais</p>
                <p className="text-gray-700 whitespace-pre-wrap">{infoAdicionais}</p>
              </div>
            )}

            {/* Total */}
            <div className="border-t pt-3 flex justify-between items-center">
              <span className="text-gray-500">Valor Total</span>
              <span className="text-xl font-bold">{formatCurrency(totalCentavos)}</span>
            </div>

            {/* Tributacao info */}
            <div className="rounded-md bg-gray-100 p-3 text-xs text-gray-500">
              Simples Nacional (Regime 1) | CSOSN {TIPO_CONFIG[tipo].cfop === 5915 || TIPO_CONFIG[tipo].cfop === 5916 ? '400' : '102'} | PIS/COFINS 07 (Isento)
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
