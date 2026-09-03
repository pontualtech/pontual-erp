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
import { explainSefazError } from '@/lib/nfe/sefaz-error-help'

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
  certificate_uploaded: boolean
  certificate_filename: string | null
  environment: string | null
  settings: Record<string, any> | null
}

interface NfeRecebida {
  id: string
  chave_nfe: string
  numero: number | null
  serie: string | null
  cnpj_emitente: string
  nome_emitente: string
  valor_total: number
  data_emissao: string | null
  // XML data armazenado pra extrair endereco/cMun do emitente quando criar cliente
  xml_data?: { xml?: string; nsu?: string } | null
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

interface TipoConfig {
  label: string
  icon: any
  cfop: number
  description: string
  color: string
  natureza: string
  finalidade: '1' | '2' | '3' | '4'  // 1=normal, 2=complementar, 3=ajuste, 4=devolucao
  tipo_operacao: '0' | '1'           // 0=entrada, 1=saida
  semPagamento: boolean              // true → pagamento tPag=90 valor=0
}

const TIPO_CONFIG: Record<NfeTipo, TipoConfig> = {
  venda: {
    label: 'Venda de Mercadoria',
    icon: ShoppingCart,
    cfop: 5102,
    description: 'Venda de produtos adquiridos ou recebidos de terceiros',
    color: 'border-blue-500 bg-blue-50 text-blue-700',
    natureza: 'VENDA DE MERCADORIA',
    finalidade: '1',
    tipo_operacao: '1',
    semPagamento: false,
  },
  remessa_conserto: {
    label: 'Remessa p/ Conserto',
    icon: Wrench,
    cfop: 5915,
    description: 'Remessa de equipamento para conserto - ICMS suspenso',
    color: 'border-orange-500 bg-orange-50 text-orange-700',
    natureza: 'REMESSA P/ CONSERTO',
    finalidade: '1',
    tipo_operacao: '1',
    semPagamento: true,
  },
  retorno_conserto: {
    label: 'Retorno de Conserto',
    icon: RotateCcw,
    cfop: 5916,
    description: 'Retorno de mercadoria recebida para conserto - exige NF-e original',
    color: 'border-green-500 bg-green-50 text-green-700',
    natureza: 'RETORNO DE MERCADORIA RECEBIDA P/ CONSERTO',
    finalidade: '1',
    tipo_operacao: '1',
    semPagamento: true,
  },
  devolucao: {
    label: 'Devolucao',
    icon: Package,
    cfop: 5202,
    description: 'Devolucao de mercadoria adquirida - exige NF-e original',
    color: 'border-red-500 bg-red-50 text-red-700',
    natureza: 'DEVOLUCAO DE VENDA',
    finalidade: '4',
    tipo_operacao: '1',
    semPagamento: true,
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

  // Bonus 2026-06-09: importar de NF-e recebida (atalho pra retorno_conserto)
  const [showRecebidasModal, setShowRecebidasModal] = useState(false)
  const [nfesRecebidas, setNfesRecebidas] = useState<NfeRecebida[]>([])
  const [loadingRecebidas, setLoadingRecebidas] = useState(false)
  const [importingFromRecebida, setImportingFromRecebida] = useState<string | null>(null)

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
      // 2026-06-09: migrado de /api/fiscal/nfe (Focus NFe terceirizado) para
      // /api/fiscal/nfe-emitir (SEFAZ direto via cert A1). Body mapping novo.
      const tipoCfg = TIPO_CONFIG[tipo]
      const totalReais = items.reduce(
        (sum, i) => sum + (i.valor_unitario_centavos * i.quantidade), 0
      ) / 100
      const payload = {
        customer_id: selectedCliente.id,
        natureza_operacao: tipoCfg.natureza,
        tipo_operacao: tipoCfg.tipo_operacao,
        finalidade: tipoCfg.finalidade,
        items: items.map(item => ({
          product_id: item.product_id || undefined,
          descricao: item.descricao,
          quantidade: item.quantidade,
          // SEFAZ direto espera valor_unitario em REAIS (não centavos)
          valor_unitario: item.valor_unitario_centavos / 100,
          cfop: item.cfop ? Number(item.cfop) : undefined,
          ncm: item.ncm || undefined,
          unidade: item.unidade || 'UN',
          codigo_produto: item.codigo_produto || undefined,
        })),
        // Pagamentos: tPag=90 (sem pagamento) pra remessa/retorno/devolucao.
        // Venda usa tPag=99 (outros) valor total — Karlao pode ajustar via UI futura.
        // 2026-06-09: tPag=90 EXIGE vPag=vNF (valor total) — vPag=0 da rejeicao SEFAZ.
        pagamentos: tipoCfg.semPagamento
          ? [{ forma: '90', valor: totalReais }]
          : [{ forma: '99', valor: totalReais }],
        chaves_referenciadas: notasReferenciadas.length > 0 ? notasReferenciadas : undefined,
        informacoes_adicionais: infoAdicionais || undefined,
      }

      const res = await fetch('/api/fiscal/nfe-emitir', {
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

  // Bonus 2026-06-09: carrega NF-es recebidas pra atalho de retorno_conserto
  async function openRecebidasModal() {
    setShowRecebidasModal(true)
    setLoadingRecebidas(true)
    try {
      const r = await fetch('/api/fiscal/nfe-recebidas?limit=30')
      const d = await r.json()
      setNfesRecebidas(d.data?.data ?? d.data ?? [])
    } catch {
      toast.error('Erro ao carregar NF-es recebidas')
    } finally {
      setLoadingRecebidas(false)
    }
  }

  // Importa dados da NF-e recebida: emitente vira destinatario, item replicado,
  // chave referenciada pre-popula. Cria customer se nao existir (por CNPJ).
  // 2026-06-09: tambem extrai endereco completo + cod_municipio do XML emitente
  // (campo SEFAZ obrigatorio pra emissao - sem ele NF cai em fallback SP capital).
  async function importFromRecebida(nfe: NfeRecebida) {
    setImportingFromRecebida(nfe.id)
    try {
      // 0. Parse XML pra extrair endereco completo do emitente (vira destinatario do retorno)
      const xml = nfe.xml_data?.xml || ''
      const emitMatch = xml.match(/<emit>([\s\S]*?)<\/emit>/)?.[1] || ''
      const emitData = {
        xLgr: emitMatch.match(/<xLgr>([^<]+)<\/xLgr>/)?.[1] || '',
        nro: emitMatch.match(/<nro>([^<]+)<\/nro>/)?.[1] || '',
        xBairro: emitMatch.match(/<xBairro>([^<]+)<\/xBairro>/)?.[1] || '',
        cMun: emitMatch.match(/<cMun>(\d{7})<\/cMun>/)?.[1] || '',
        xMun: emitMatch.match(/<xMun>([^<]+)<\/xMun>/)?.[1] || '',
        UF: emitMatch.match(/<UF>([A-Z]{2})<\/UF>/)?.[1] || '',
        CEP: emitMatch.match(/<CEP>(\d+)<\/CEP>/)?.[1] || '',
        IE: emitMatch.match(/<IE>([^<]+)<\/IE>/)?.[1] || '',
      }

      // 1. Procurar/criar customer pelo CNPJ emitente
      const cnpj = nfe.cnpj_emitente
      const searchRes = await fetch(`/api/clientes?search=${cnpj}&limit=1`)
      const searchData = await searchRes.json()
      let customer: Cliente | null = (searchData.data ?? [])[0] ?? null

      // Payload com endereco completo (criar OU atualizar para preencher cod_municipio se faltar)
      const customerPayload: Record<string, any> = {
        legal_name: nfe.nome_emitente,
        document_number: cnpj,
        person_type: 'PJ',
      }
      if (emitData.xLgr) customerPayload.address_street = emitData.xLgr
      if (emitData.nro) customerPayload.address_number = emitData.nro
      if (emitData.xBairro) customerPayload.address_neighborhood = emitData.xBairro
      if (emitData.xMun) customerPayload.address_city = emitData.xMun
      if (emitData.UF) customerPayload.address_state = emitData.UF
      if (emitData.CEP) customerPayload.address_zip = emitData.CEP
      if (emitData.cMun) customerPayload.cod_municipio = emitData.cMun
      if (emitData.IE) customerPayload.state_registration = emitData.IE

      if (!customer) {
        const createRes = await fetch('/api/clientes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(customerPayload),
        })
        const createData = await createRes.json()
        if (!createRes.ok) throw new Error(createData.error || 'Erro ao criar cliente')
        customer = createData.data
      } else {
        // Auditoria 03/09 (caso CNCSERV): cliente existente com IE/endereco
        // VAZIOS nao era atualizado (so cod_municipio era) — IE vazia vira
        // "Isento" e a SEFAZ rejeita ("NF-e sem informacao da IE", fix 2 Renner).
        // Preenche campos fiscais FALTANTES a partir do XML; nunca sobrescreve
        // valor ja preenchido no cadastro.
        const cur = customer as any
        const fillPatch: Record<string, string> = {}
        if (!cur.cod_municipio && emitData.cMun) fillPatch.cod_municipio = emitData.cMun
        if (!cur.state_registration && emitData.IE) fillPatch.state_registration = emitData.IE
        if (!cur.address_number && emitData.nro) fillPatch.address_number = emitData.nro
        if (Object.keys(fillPatch).length > 0) {
          try {
            const patchRes = await fetch(`/api/clientes/${customer.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fillPatch),
            })
            if (patchRes.ok) {
              const patchData = await patchRes.json()
              customer = patchData.data || customer
            } else {
              toast.error(`Nao consegui completar o cadastro do cliente (${Object.keys(fillPatch).join(', ')}). Confira em Clientes antes de emitir.`)
            }
          } catch { /* nao bloqueia se PATCH falhar - admin pode editar manualmente */ }
        }
      }

      if (customer) {
        setSelectedCliente(customer)
        setClienteSearch(customer.legal_name)
      }

      // 2. Adiciona chave referenciada
      if (!notasReferenciadas.includes(nfe.chave_nfe)) {
        setNotasReferenciadas(prev => [...prev, nfe.chave_nfe])
      }

      // 3. Pre-popula 1 item com valor da NF original (Karlao ajusta descricao/NCM)
      const valorReais = nfe.valor_total / 100
      setItems([{
        key: ++itemKeyCounter,
        product_id: '',
        descricao: `Mercadoria recebida para conserto - NF ${nfe.numero ?? ''}`,
        quantidade: 1,
        valor_unitario_display: valorReais.toFixed(2).replace('.', ','),
        valor_unitario_centavos: nfe.valor_total,
        ncm: '',
        cfop: String(TIPO_CONFIG[tipo].cfop),
        unidade: 'UN',
        codigo_produto: '',
      }])

      // 4. Info adicionais padrao retorno conserto (Karlao pode editar)
      if (tipo === 'retorno_conserto' && !infoAdicionais) {
        setInfoAdicionais('RETORNO DE MERCADORIA RECEBIDA PARA CONSERTO. ICMS NAO-INCIDENCIA (Art. 7º, Inciso IX, RICMS/SP). IPI NAO-INCIDENCIA (Art. 5º, Incisos XI e XII, Decreto 4.544/2002).')
      }

      toast.success(`Dados importados da NF ${nfe.numero ?? nfe.chave_nfe.slice(-9)}`)
      setShowRecebidasModal(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar NF-e')
    } finally {
      setImportingFromRecebida(null)
    }
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
        desc: 'Veja abaixo o que aconteceu e clique em "Corrigir esta NF-e" pra ajustar.',
      },
    }

    const statusInfo = statusMap[emissionResult.status] || statusMap.PROCESSING
    const StatusIcon = statusInfo.icon

    // Mensagem técnica da SEFAZ vem em emissionResult.notes geralmente no formato:
    // "NF-e 209 ... | Rejeição: Informado indevidamente campo valor de pagamento"
    const sefazMsg = (emissionResult.notes || '').split('|').pop()?.trim() || ''
    const isRejected = emissionResult.status === 'REJECTED'
    const errorHelp = isRejected ? explainSefazError(sefazMsg) : null

    return (
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/fiscal" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            {isRejected ? 'NF-e Não Autorizada' : 'NF-e Emitida'}
          </h1>
        </div>

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <StatusIcon className={cn('h-8 w-8', statusInfo.color, emissionResult.status === 'PROCESSING' && 'animate-spin')} />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{statusInfo.label}</h2>
              <p className="text-sm text-gray-500">{statusInfo.desc}</p>
            </div>
          </div>

          {/* Bloco de ajuda humanizada (só quando REJECTED) */}
          {isRejected && errorHelp && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 mb-4 space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-1">Motivo da SEFAZ</p>
                <p className="text-sm text-red-900 font-mono">{sefazMsg || '(sem motivo informado)'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-1">O que isso significa</p>
                <p className="text-sm text-gray-800">{errorHelp.explanation}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-1">O que fazer</p>
                <p className="text-sm text-gray-800">{errorHelp.suggestion}</p>
              </div>
            </div>
          )}

          <div className="space-y-3 border-t pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Tipo</span>
              <span className="font-medium">{emissionResult.notes?.split('|')[0]?.trim() || tipo}</span>
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
            {/* Botão prioritário em rejeição: preserva todos os dados pra correção rápida */}
            {isRejected && (
              <button
                type="button"
                onClick={() => { setEmissionResult(null); setEmissionError(null) }}
                className="flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
              >
                <ArrowLeft className="h-4 w-4" /> Corrigir esta NF-e
              </button>
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
              {isRejected ? 'Começar do zero' : 'Emitir Nova NF-e'}
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

      {!config?.certificate_uploaded && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2">
          <XCircle className="h-4 w-4 shrink-0" />
          <div>
            Certificado digital A1 nao instalado. Sem ele, nao e possivel emitir NF-e direto na SEFAZ.{' '}
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
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">1</span>
          Tipo de operação
        </h2>
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
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">2</span>
          Destinatário
        </h2>
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
          <div className="flex items-start justify-between mb-2">
            <div>
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">★</span>
                NF-e original (referenciada)
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Informe a(s) chave(s) da(s) NF-e original(is) de {tipo === 'retorno_conserto' ? 'remessa para conserto' : 'compra'}.
              </p>
            </div>
            <button
              type="button"
              onClick={openRecebidasModal}
              className="flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
              title="Importa chave + emitente + valor de uma NF-e recebida na SEFAZ"
            >
              <Download className="h-3.5 w-3.5" /> Importar de NF Recebida
            </button>
          </div>

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
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">3</span>
          Itens da nota
        </h2>

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
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">4</span>
          Informações adicionais <span className="text-xs font-normal text-gray-400">(opcional)</span>
        </h2>
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

      {/* BONUS: Modal Importar de NF Recebida */}
      {showRecebidasModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowRecebidasModal(false)}>
          <div className="w-full max-w-3xl max-h-[80vh] rounded-lg bg-white shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Importar de NF-e Recebida</h2>
                <p className="text-xs text-gray-500 mt-0.5">Clique numa NF-e pra auto-popular destinatario, chave referenciada e valor.</p>
              </div>
              <button type="button" onClick={() => setShowRecebidasModal(false)} title="Fechar modal" aria-label="Fechar" className="p-1 rounded hover:bg-gray-100 text-gray-400">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadingRecebidas ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                </div>
              ) : nfesRecebidas.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm">
                  Nenhuma NF-e recebida encontrada.{' '}
                  <Link href="/fiscal/recebidas" className="text-blue-600 underline">Sincronizar com SEFAZ</Link>
                </div>
              ) : (
                <div className="space-y-1">
                  {nfesRecebidas.map(nfe => {
                    const isAlreadyAdded = notasReferenciadas.includes(nfe.chave_nfe)
                    return (
                      <button
                        key={nfe.id}
                        type="button"
                        onClick={() => importFromRecebida(nfe)}
                        disabled={importingFromRecebida === nfe.id || isAlreadyAdded}
                        className="w-full text-left rounded-md border p-3 hover:bg-blue-50 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm text-gray-900 truncate">{nfe.nome_emitente}</span>
                              {isAlreadyAdded && (
                                <span className="text-xs text-green-600">✓ ja adicionada</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              NF {nfe.numero ?? '—'}/{nfe.serie ?? '—'} · CNPJ {formatDocument(nfe.cnpj_emitente)}
                            </p>
                            <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">{nfe.chave_nfe}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-medium text-gray-900">{formatCurrency(nfe.valor_total)}</div>
                            <div className="text-xs text-gray-500">
                              {nfe.data_emissao ? new Date(nfe.data_emissao).toLocaleDateString('pt-BR') : '—'}
                            </div>
                            {importingFromRecebida === nfe.id && (
                              <Loader2 className="h-3 w-3 animate-spin text-blue-500 ml-auto mt-1" />
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center p-4 border-t bg-gray-50 text-xs text-gray-500">
              <span>{nfesRecebidas.length} NF-e(s) sincronizadas</span>
              <Link href="/fiscal/recebidas" className="text-blue-600 hover:underline">
                Ver todas / Sincronizar SEFAZ →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
