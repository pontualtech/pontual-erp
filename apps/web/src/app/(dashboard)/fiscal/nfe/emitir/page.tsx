'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn, formatDocument } from '@/lib/utils'
import {
  ArrowLeft, ArrowRight, Send, Loader2, Plus, Trash2, Search,
  CheckCircle2, XCircle, AlertTriangle, Download, FileText,
  ShoppingCart, Wrench, RotateCcw, Package, Home,
  DollarSign, CreditCard, Banknote, QrCode, Receipt,
  ChevronRight, Info, MapPin, Truck, CircleDot,
  Check, Printer, RefreshCw, User, Building2,
} from 'lucide-react'
import { toast } from 'sonner'

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

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
  inscricao_estadual: string | null
  email: string | null
  cod_municipio: string | null
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
  valor_unitario: number
  desconto: number
  desconto_display: string
  ncm: string
  cfop: string
  unidade: string
  codigo_produto: string
}

interface TransporteData {
  modalidade_frete: string // 0, 1, 9
  transportadora_nome: string
  transportadora_cnpj: string
  placa: string
  volumes: string
  peso_bruto: string
  peso_liquido: string
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

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const NATUREZAS = [
  { value: 'VENDA DE MERCADORIA', label: 'Venda de Mercadoria', icon: ShoppingCart, cfop: '5102', color: 'blue', desc: 'Venda padrao de produtos' },
  { value: 'DEVOLUCAO DE MERCADORIA', label: 'Devolucao', icon: RotateCcw, cfop: '5202', color: 'red', desc: 'Devolucao de mercadoria recebida' },
  { value: 'REMESSA PARA CONSERTO', label: 'Remessa Conserto', icon: Wrench, cfop: '5915', color: 'orange', desc: 'Envio de equipamento para reparo' },
  { value: 'RETORNO DE CONSERTO', label: 'Retorno Conserto', icon: Package, cfop: '5916', color: 'green', desc: 'Retorno de equipamento reparado' },
  { value: 'REMESSA EM GARANTIA', label: 'Remessa Garantia', icon: Package, cfop: '5949', color: 'purple', desc: 'Envio em garantia' },
  { value: 'OUTRAS SAIDAS', label: 'Outras Saidas', icon: FileText, cfop: '5949', color: 'gray', desc: 'Outras operacoes de saida' },
]

const PAGAMENTOS = [
  { value: '17', label: 'PIX', icon: QrCode, color: 'emerald' },
  { value: '01', label: 'Dinheiro', icon: Banknote, color: 'green' },
  { value: '03', label: 'Cartao Credito', icon: CreditCard, color: 'blue' },
  { value: '04', label: 'Cartao Debito', icon: CreditCard, color: 'indigo' },
  { value: '15', label: 'Boleto', icon: Receipt, color: 'amber' },
  { value: '99', label: 'Outros', icon: DollarSign, color: 'gray' },
]

const FRETE_OPTIONS = [
  { value: '9', label: 'Sem Frete', desc: 'Nenhum transporte' },
  { value: '0', label: 'Emitente (CIF)', desc: 'Frete por conta do remetente' },
  { value: '1', label: 'Destinatario (FOB)', desc: 'Frete por conta do destinatario' },
]

const STEPS = [
  { number: 1, label: 'Cabecalho', desc: 'Cliente e Natureza' },
  { number: 2, label: 'Itens', desc: 'Produtos da Nota' },
  { number: 3, label: 'Transporte', desc: 'Frete e Pagamento' },
  { number: 4, label: 'Revisao', desc: 'Conferir e Emitir' },
]

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

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
    desconto: 0,
    desconto_display: '0,00',
    ncm: '',
    cfop: '',
    unidade: 'UN',
    codigo_produto: '',
  }
}

const colorMap: Record<string, { bg: string; border: string; text: string; ring: string; icon: string; bgLight: string }> = {
  blue:    { bg: 'bg-blue-50',    border: 'border-blue-200',   text: 'text-blue-700',    ring: 'ring-blue-500',   icon: 'text-blue-500',   bgLight: 'bg-blue-100' },
  red:     { bg: 'bg-red-50',     border: 'border-red-200',    text: 'text-red-700',     ring: 'ring-red-500',    icon: 'text-red-500',    bgLight: 'bg-red-100' },
  orange:  { bg: 'bg-orange-50',  border: 'border-orange-200', text: 'text-orange-700',  ring: 'ring-orange-500', icon: 'text-orange-500', bgLight: 'bg-orange-100' },
  green:   { bg: 'bg-green-50',   border: 'border-green-200',  text: 'text-green-700',   ring: 'ring-green-500',  icon: 'text-green-500',  bgLight: 'bg-green-100' },
  purple:  { bg: 'bg-purple-50',  border: 'border-purple-200', text: 'text-purple-700',  ring: 'ring-purple-500', icon: 'text-purple-500', bgLight: 'bg-purple-100' },
  gray:    { bg: 'bg-gray-50',    border: 'border-gray-200',   text: 'text-gray-700',    ring: 'ring-gray-500',   icon: 'text-gray-500',   bgLight: 'bg-gray-100' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200',text: 'text-emerald-700', ring: 'ring-emerald-500',icon: 'text-emerald-500',bgLight: 'bg-emerald-100' },
  indigo:  { bg: 'bg-indigo-50',  border: 'border-indigo-200', text: 'text-indigo-700',  ring: 'ring-indigo-500', icon: 'text-indigo-500', bgLight: 'bg-indigo-100' },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',  text: 'text-amber-700',   ring: 'ring-amber-500',  icon: 'text-amber-500',  bgLight: 'bg-amber-100' },
}

// ═══════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════

export default function EmitirNfePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const reemitirId = searchParams.get('reemitir')

  // Step
  const [currentStep, setCurrentStep] = useState(1)

  // SEFAZ
  const [sefazOnline, setSefazOnline] = useState(true)
  const [loadingReemitir, setLoadingReemitir] = useState(!!reemitirId)

  // Step 1 — Header
  const [natureza, setNatureza] = useState(NATUREZAS[0].value)
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null)
  const [clienteSearch, setClienteSearch] = useState('')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)
  const [cnpjSearch, setCnpjSearch] = useState('')
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const clienteRef = useRef<HTMLDivElement>(null)

  // Step 2 — Items
  const [items, setItems] = useState<ItemForm[]>([createEmptyItem()])
  const [produtoSearches, setProdutoSearches] = useState<Record<number, string>>({})
  const [produtoResults, setProdutoResults] = useState<Record<number, Produto[]>>({})
  const [showProdutoDropdown, setShowProdutoDropdown] = useState<number | null>(null)

  // Step 3 — Transport & Payment
  const [transporte, setTransporte] = useState<TransporteData>({
    modalidade_frete: '9',
    transportadora_nome: '',
    transportadora_cnpj: '',
    placa: '',
    volumes: '',
    peso_bruto: '',
    peso_liquido: '',
  })
  const [formaPagamento, setFormaPagamento] = useState('17')
  const [valorPagamento, setValorPagamento] = useState('')
  const [infoAdicionais, setInfoAdicionais] = useState('')

  // Referenced keys (for devolution/return)
  const [chavesReferenciadas, setChavesReferenciadas] = useState<string[]>([])
  const [novaChaveRef, setNovaChaveRef] = useState('')

  // Step 4 — Emission
  const [submitting, setSubmitting] = useState(false)
  const [emissionPhase, setEmissionPhase] = useState(0) // 0=idle, 1=signing, 2=sending, 3=waiting, 4=done
  const [result, setResult] = useState<EmissionResult | null>(null)
  const [resultError, setResultError] = useState<string | null>(null)

  // ─── Derived ───
  const selectedNat = NATUREZAS.find(n => n.value === natureza)!
  const needsRef = natureza.includes('DEVOLUCAO') || natureza.includes('RETORNO')

  const totalBruto = items.reduce((sum, i) => sum + (i.valor_unitario * i.quantidade), 0)
  const totalDesconto = items.reduce((sum, i) => sum + i.desconto, 0)
  const totalReais = totalBruto - totalDesconto

  // ─── Step validation ───
  const step1Valid = !!selectedCliente && !!natureza
  const step2Valid = items.length > 0 && items.every(i =>
    i.descricao.trim() && i.valor_unitario > 0 && i.quantidade > 0 && i.ncm.replace(/\D/g, '').length === 8
  ) && (!needsRef || chavesReferenciadas.length > 0)
  const step3Valid = !!formaPagamento
  const canSubmit = step1Valid && step2Valid && step3Valid

  // ═══════════════════════════════════════════════════════
  // Effects
  // ═══════════════════════════════════════════════════════

  // SEFAZ status check
  useEffect(() => {
    fetch('/api/fiscal/nfe-status')
      .then(r => r.json())
      .then(d => setSefazOnline(d.data?.online ?? true))
      .catch(() => setSefazOnline(true))
  }, [])

  // Re-emit: load rejected NF-e
  useEffect(() => {
    if (!reemitirId) return
    setLoadingReemitir(true)
    fetch(`/api/fiscal/nfe/${reemitirId}`)
      .then(r => r.json())
      .then(d => {
        const nfe = d.data
        if (!nfe) return
        if (nfe.notes) {
          const nat = NATUREZAS.find(n => nfe.notes?.includes(n.value))
          if (nat) setNatureza(nat.value)
        }
        if (nfe.payment_method_nfe) setFormaPagamento(nfe.payment_method_nfe)
        if (nfe.customers) {
          setSelectedCliente(nfe.customers)
          setClienteSearch(nfe.customers.legal_name || '')
        }
        if (nfe.invoice_items?.length) {
          const loadedItems: ItemForm[] = nfe.invoice_items.map((it: any) => ({
            key: ++itemKeyCounter,
            product_id: '',
            descricao: it.description || '',
            quantidade: it.quantity || 1,
            valor_unitario_display: ((it.unit_price || 0) / 100).toFixed(2).replace('.', ','),
            valor_unitario: (it.unit_price || 0) / 100,
            desconto: 0,
            desconto_display: '0,00',
            ncm: it.ncm || it.codigo_produto_fiscal || '',
            cfop: it.cfop || '',
            unidade: it.unidade || 'UN',
            codigo_produto: it.codigo_produto_fiscal || '',
          }))
          setItems(loadedItems.length ? loadedItems : [createEmptyItem()])
        }
        if (nfe.additional_info) setInfoAdicionais(nfe.additional_info)
        if (nfe.nfe_referenced_keys?.length) setChavesReferenciadas(nfe.nfe_referenced_keys)
        toast.info('Dados da NF-e rejeitada carregados. Corrija e reenvie.')
      })
      .catch(() => toast.error('Erro ao carregar NF-e para reemissao'))
      .finally(() => setLoadingReemitir(false))
  }, [reemitirId])

  // Client search debounce
  useEffect(() => {
    if (clienteSearch.length < 2) { setClientes([]); return }
    const timer = setTimeout(() => {
      fetch(`/api/clientes?search=${encodeURIComponent(clienteSearch)}&limit=10`)
        .then(r => r.json())
        .then(d => { setClientes(d.data ?? []); setShowClienteDropdown(true) })
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [clienteSearch])

  // Click outside dropdown
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (clienteRef.current && !clienteRef.current.contains(e.target as Node)) {
        setShowClienteDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Auto-fill payment value from total
  useEffect(() => {
    if (totalReais > 0) {
      setValorPagamento(totalReais.toFixed(2).replace('.', ','))
    }
  }, [totalReais])

  // ═══════════════════════════════════════════════════════
  // Handlers
  // ═══════════════════════════════════════════════════════

  function selectCliente(c: Cliente) {
    setSelectedCliente(c)
    setClienteSearch(c.legal_name)
    setShowClienteDropdown(false)
  }

  // CNPJ lookup via ReceitaWS
  async function buscarCnpj() {
    const digits = cnpjSearch.replace(/\D/g, '')
    if (digits.length !== 14) {
      toast.error('CNPJ deve ter 14 digitos')
      return
    }
    setCnpjLoading(true)
    try {
      const res = await fetch(`/api/clientes/busca-cnpj?cnpj=${digits}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')
      const empresa = data.data
      if (empresa) {
        const newCliente: Cliente = {
          id: '',
          legal_name: empresa.razao_social || empresa.nome || '',
          document_number: digits,
          person_type: 'PJ',
          address_street: empresa.logradouro || null,
          address_number: empresa.numero || null,
          address_complement: empresa.complemento || null,
          address_neighborhood: empresa.bairro || null,
          address_city: empresa.municipio || null,
          address_state: empresa.uf || null,
          address_zip: empresa.cep?.replace(/\D/g, '') || null,
          state_registration: null,
          inscricao_estadual: null,
          email: empresa.email || null,
          cod_municipio: empresa.codigo_municipio || null,
        }
        setSelectedCliente(newCliente)
        setClienteSearch(newCliente.legal_name)
        toast.success('Dados do CNPJ carregados')
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao buscar CNPJ')
    } finally {
      setCnpjLoading(false)
    }
  }

  // CEP lookup via ViaCEP
  async function buscarCep(cep: string) {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) {
      toast.error('CEP deve ter 8 digitos')
      return
    }
    setCepLoading(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = await res.json()
      if (data.erro) throw new Error('CEP nao encontrado')
      if (selectedCliente) {
        setSelectedCliente({
          ...selectedCliente,
          address_street: data.logradouro || selectedCliente.address_street,
          address_neighborhood: data.bairro || selectedCliente.address_neighborhood,
          address_city: data.localidade || selectedCliente.address_city,
          address_state: data.uf || selectedCliente.address_state,
          address_zip: digits,
          cod_municipio: data.ibge || selectedCliente.cod_municipio,
        })
        toast.success('Endereco atualizado pelo CEP')
      }
    } catch {
      toast.error('CEP nao encontrado')
    } finally {
      setCepLoading(false)
    }
  }

  // Product search
  function handleProdutoSearch(itemKey: number, search: string) {
    setProdutoSearches(prev => ({ ...prev, [itemKey]: search }))
    if (search.length < 2) {
      setProdutoResults(prev => ({ ...prev, [itemKey]: [] }))
      return
    }
    setTimeout(() => {
      fetch(`/api/produtos?search=${encodeURIComponent(search)}&limit=8`)
        .then(r => r.json())
        .then(d => {
          setProdutoResults(prev => ({ ...prev, [itemKey]: d.data ?? [] }))
          setShowProdutoDropdown(itemKey)
        })
        .catch(() => {})
    }, 300)
  }

  function selectProduto(produto: Produto, itemIndex: number) {
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
      if (field === 'desconto_display') {
        return { ...item, desconto_display: value, desconto: parseCurrencyInput(value) }
      }
      return { ...item, [field]: value }
    }))
  }

  function addItem() { setItems(prev => [...prev, createEmptyItem()]) }
  function removeItem(index: number) {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  function addChaveRef() {
    const chave = novaChaveRef.replace(/\D/g, '')
    if (chave.length !== 44) { toast.error('Chave NF-e deve ter 44 digitos'); return }
    if (chavesReferenciadas.includes(chave)) { toast.error('Chave ja adicionada'); return }
    setChavesReferenciadas(prev => [...prev, chave])
    setNovaChaveRef('')
  }

  // Step navigation
  function goNext() {
    if (currentStep === 1 && !step1Valid) {
      toast.error('Selecione um cliente e a natureza da operacao')
      return
    }
    if (currentStep === 2 && !step2Valid) {
      const badItem = items.find(i => i.ncm.replace(/\D/g, '').length !== 8)
      if (badItem) {
        toast.error('NCM deve ter exatamente 8 digitos em todos os itens')
        return
      }
      toast.error('Preencha todos os campos obrigatorios dos itens')
      return
    }
    if (currentStep < 4) setCurrentStep(prev => prev + 1)
  }

  function goPrev() {
    if (currentStep > 1) setCurrentStep(prev => prev - 1)
  }

  function goToStep(step: number) {
    // Only allow going to completed steps or current+1
    if (step < currentStep) setCurrentStep(step)
    if (step === 2 && step1Valid) setCurrentStep(step)
    if (step === 3 && step1Valid && step2Valid) setCurrentStep(step)
    if (step === 4 && step1Valid && step2Valid && step3Valid) setCurrentStep(step)
  }

  // ─── Submit ───
  async function handleSubmit() {
    if (!canSubmit || !selectedCliente) return
    setSubmitting(true)
    setResultError(null)
    setResult(null)
    setEmissionPhase(1)

    // Visual delay for signing phase
    await new Promise(r => setTimeout(r, 800))
    setEmissionPhase(2)

    // Visual delay for sending phase
    await new Promise(r => setTimeout(r, 600))
    setEmissionPhase(3)

    try {
      const payload = {
        customer_id: selectedCliente.id,
        natureza_operacao: natureza,
        tipo_operacao: '1',
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
          { forma: formaPagamento, valor: parseCurrencyInput(valorPagamento) || totalReais },
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
      setEmissionPhase(4)

      if (!res.ok) {
        setResultError(data.error || 'Erro ao emitir NF-e')
        toast.error(data.error || 'Erro ao emitir NF-e')
        return
      }

      setResult(data.data)
      if (data.data?.status === 'AUTHORIZED') {
        toast.success(`NF-e #${data.data.numero} autorizada!`)
      } else if (data.data?.status === 'PROCESSING') {
        toast.info('NF-e enviada para processamento')
      } else {
        toast.error(`NF-e rejeitada: ${data.data?.motivo || 'Erro'}`)
      }
    } catch {
      setEmissionPhase(4)
      setResultError('Erro de conexao com o servidor')
      toast.error('Erro de conexao')
    } finally {
      setSubmitting(false)
    }
  }

  function resetForm() {
    setResult(null)
    setResultError(null)
    setSelectedCliente(null)
    setClienteSearch('')
    setItems([createEmptyItem()])
    setChavesReferenciadas([])
    setInfoAdicionais('')
    setFormaPagamento('17')
    setValorPagamento('')
    setTransporte({ modalidade_frete: '9', transportadora_nome: '', transportadora_cnpj: '', placa: '', volumes: '', peso_bruto: '', peso_liquido: '' })
    setCurrentStep(1)
    setEmissionPhase(0)
    setSubmitting(false)
  }

  // ═══════════════════════════════════════════════════════
  // Loading state
  // ═══════════════════════════════════════════════════════

  if (loadingReemitir) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-3 text-gray-500">Carregando NF-e para reemissao...</span>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <Link href="/" className="hover:text-gray-600 flex items-center gap-1"><Home className="h-3.5 w-3.5" /> Inicio</Link>
        <span>/</span>
        <Link href="/fiscal" className="hover:text-gray-600">Fiscal</Link>
        <span>/</span>
        <Link href="/fiscal/nfe" className="hover:text-gray-600">NF-e</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Emitir</span>
      </nav>

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/fiscal/nfe" className="rounded-lg border p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {reemitirId ? 'Reemitir NF-e' : 'Emitir NF-e'}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Nota Fiscal Eletronica — Modelo 55</p>
          </div>
        </div>
        <div className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
          sefazOnline ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'
        )}>
          <span className={cn('h-2.5 w-2.5 rounded-full', sefazOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500')} />
          SEFAZ {sefazOnline ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* ═══ STEPPER ═══ */}
      <div className="relative">
        <div className="flex items-center justify-between">
          {STEPS.map((step, idx) => {
            const isActive = currentStep === step.number
            const isCompleted = currentStep > step.number
            const isClickable = (step.number === 1) ||
              (step.number === 2 && step1Valid) ||
              (step.number === 3 && step1Valid && step2Valid) ||
              (step.number === 4 && step1Valid && step2Valid && step3Valid)

            return (
              <div key={step.number} className="flex items-center flex-1 last:flex-none">
                <button
                  type="button"
                  onClick={() => goToStep(step.number)}
                  disabled={!isClickable && !isCompleted}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-4 py-3 transition-all',
                    isActive && 'bg-blue-50 border border-blue-200',
                    isCompleted && 'cursor-pointer hover:bg-green-50',
                    !isActive && !isCompleted && isClickable && 'cursor-pointer hover:bg-gray-50',
                    !isActive && !isCompleted && !isClickable && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <div className={cn(
                    'flex items-center justify-center h-9 w-9 rounded-full text-sm font-bold shrink-0 transition-all',
                    isActive && 'bg-blue-600 text-white shadow-md shadow-blue-200',
                    isCompleted && 'bg-green-500 text-white',
                    !isActive && !isCompleted && 'bg-gray-200 text-gray-500',
                  )}>
                    {isCompleted ? <Check className="h-4 w-4" /> : step.number}
                  </div>
                  <div className="text-left hidden sm:block">
                    <p className={cn(
                      'text-sm font-semibold',
                      isActive ? 'text-blue-700' : isCompleted ? 'text-green-700' : 'text-gray-500',
                    )}>{step.label}</p>
                    <p className="text-xs text-gray-400">{step.desc}</p>
                  </div>
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={cn(
                    'flex-1 h-0.5 mx-2',
                    isCompleted ? 'bg-green-300' : 'bg-gray-200',
                  )} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Error banner */}
      {resultError && !result && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Erro na emissao</p>
            <p className="mt-0.5">{resultError}</p>
          </div>
          <button type="button" onClick={() => setResultError(null)} aria-label="Fechar erro" className="ml-auto text-red-500 hover:text-red-700">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STEP 1: Cabecalho                              */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === 1 && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Natureza da Operacao */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Natureza da Operacao</h2>
            <p className="text-sm text-gray-400 mb-4">Selecione o tipo de operacao fiscal</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {NATUREZAS.map(nat => {
                const Icon = nat.icon
                const c = colorMap[nat.color]
                const selected = natureza === nat.value
                return (
                  <button key={nat.value} type="button"
                    onClick={() => {
                      setNatureza(nat.value)
                      setItems(prev => prev.map(item => ({ ...item, cfop: item.cfop || nat.cfop })))
                    }}
                    className={cn(
                      'relative flex flex-col items-start rounded-xl border-2 p-4 text-left transition-all',
                      selected
                        ? `${c.bg} ${c.border} ring-2 ${c.ring}`
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:shadow-sm'
                    )}>
                    <div className={cn(
                      'flex items-center justify-center h-10 w-10 rounded-lg mb-3',
                      selected ? c.bgLight : 'bg-gray-100'
                    )}>
                      <Icon className={cn('h-5 w-5', selected ? c.icon : 'text-gray-400')} />
                    </div>
                    <span className={cn('text-sm font-semibold', selected ? c.text : 'text-gray-700')}>{nat.label}</span>
                    <span className={cn(
                      'inline-block mt-1.5 rounded-full px-2 py-0.5 text-xs font-mono font-medium',
                      selected ? `${c.bgLight} ${c.text}` : 'bg-gray-100 text-gray-500'
                    )}>CFOP {nat.cfop}</span>
                    <p className="text-xs text-gray-400 mt-1">{nat.desc}</p>
                    {selected && (
                      <div className="absolute top-3 right-3">
                        <CheckCircle2 className={cn('h-5 w-5', c.icon)} />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Cliente / Destinatario */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Cliente / Destinatario</h2>
            <p className="text-sm text-gray-400 mb-4">Busque por nome ou consulte pelo CNPJ</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {/* Search by name */}
              <div ref={clienteRef} className="relative">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Buscar cliente cadastrado</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Nome, CPF ou CNPJ..."
                    value={clienteSearch}
                    onChange={e => { setClienteSearch(e.target.value); setSelectedCliente(null) }}
                    onFocus={() => clientes.length > 0 && setShowClienteDropdown(true)}
                    className="w-full rounded-lg border bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                {showClienteDropdown && clientes.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-lg border bg-white shadow-xl max-h-60 overflow-y-auto">
                    {clientes.map(c => (
                      <button key={c.id} type="button"
                        onClick={() => selectCliente(c)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-blue-50 text-sm border-b last:border-b-0">
                        <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                          {(c.document_number?.replace(/\D/g, '') || '').length === 14
                            ? <Building2 className="h-4 w-4 text-gray-400" />
                            : <User className="h-4 w-4 text-gray-400" />}
                        </div>
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

              {/* CNPJ lookup */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Buscar CNPJ na Receita</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="00.000.000/0000-00"
                    value={cnpjSearch}
                    onChange={e => setCnpjSearch(e.target.value)}
                    className="flex-1 rounded-lg border bg-white py-2.5 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <button type="button" onClick={buscarCnpj} disabled={cnpjLoading}
                    className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 shrink-0">
                    {cnpjLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Buscar CNPJ
                  </button>
                </div>
              </div>
            </div>

            {/* Selected client card */}
            {selectedCliente && (
              <div className="rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-full bg-blue-100 flex items-center justify-center">
                      {(selectedCliente.document_number?.replace(/\D/g, '') || '').length === 14
                        ? <Building2 className="h-5 w-5 text-blue-600" />
                        : <User className="h-5 w-5 text-blue-600" />}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{selectedCliente.legal_name}</p>
                      <p className="text-sm text-gray-500">{formatDocument(selectedCliente.document_number)}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => { setSelectedCliente(null); setClienteSearch('') }}
                    aria-label="Remover cliente selecionado"
                    className="rounded-lg p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50">
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Endereco</p>
                    <p className="font-medium text-gray-700">
                      {selectedCliente.address_street || '---'}{selectedCliente.address_number ? `, ${selectedCliente.address_number}` : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Cidade/UF</p>
                    <p className="font-medium text-gray-700">{selectedCliente.address_city || '---'}/{selectedCliente.address_state || '---'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">IE</p>
                    <p className="font-medium text-gray-700">{selectedCliente.inscricao_estadual || selectedCliente.state_registration || 'ISENTO'}</p>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <p className="text-xs text-gray-400 mb-0.5">CEP</p>
                      <p className="font-medium text-gray-700">{selectedCliente.address_zip || '---'}</p>
                    </div>
                    <button type="button"
                      onClick={() => selectedCliente.address_zip && buscarCep(selectedCliente.address_zip)}
                      disabled={!selectedCliente.address_zip || cepLoading}
                      className="rounded-md bg-white border px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 shrink-0">
                      {cepLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Referenced keys for devolution */}
            {needsRef && (
              <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-4">
                <h3 className="text-sm font-semibold text-orange-800 mb-1">Chaves NF-e Referenciadas</h3>
                <p className="text-xs text-orange-600 mb-3">Obrigatorio para {natureza.toLowerCase()}</p>
                <div className="flex items-center gap-2 mb-3">
                  <input type="text" value={novaChaveRef}
                    onChange={e => setNovaChaveRef(e.target.value)}
                    placeholder="Chave de acesso (44 digitos)"
                    className="flex-1 rounded-md border bg-white px-3 py-2 text-sm font-mono outline-none focus:border-orange-500" />
                  <button type="button" onClick={addChaveRef}
                    aria-label="Adicionar chave referenciada"
                    className="rounded-md bg-orange-100 px-3 py-2 text-sm font-medium text-orange-800 hover:bg-orange-200">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {chavesReferenciadas.length > 0 ? (
                  <div className="space-y-2">
                    {chavesReferenciadas.map((chave, i) => (
                      <div key={i} className="flex items-center justify-between rounded-md bg-white border px-3 py-2">
                        <span className="font-mono text-xs text-gray-700 truncate">{chave}</span>
                        <button type="button" onClick={() => setChavesReferenciadas(prev => prev.filter((_, idx) => idx !== i))}
                          aria-label="Remover chave referenciada"
                          className="ml-2 text-gray-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> Pelo menos uma chave e obrigatoria
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STEP 2: Itens da Nota                          */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === 2 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Itens da Nota</h2>
                <p className="text-sm text-gray-400">{items.length} {items.length === 1 ? 'item' : 'itens'} adicionados</p>
              </div>
              <button type="button" onClick={addItem}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 shadow-sm">
                <Plus className="h-4 w-4" /> Adicionar Item
              </button>
            </div>

            {/* Items table header (desktop) */}
            <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 rounded-t-lg border">
              <div className="col-span-4">Produto</div>
              <div className="col-span-2">NCM</div>
              <div className="col-span-1">Qtd</div>
              <div className="col-span-2">V. Unitario</div>
              <div className="col-span-1">Desconto</div>
              <div className="col-span-1 text-right">Total</div>
              <div className="col-span-1"></div>
            </div>

            <div className="space-y-3 sm:space-y-0">
              {items.map((item, idx) => (
                <div key={item.key} className="rounded-lg sm:rounded-none border sm:border-x sm:border-b sm:first:rounded-t-none p-4 sm:p-3 bg-white hover:bg-gray-50/50 transition-colors">
                  {/* Product search */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                    <input type="text"
                      placeholder="Buscar produto no catalogo..."
                      value={produtoSearches[item.key] || ''}
                      onChange={e => handleProdutoSearch(item.key, e.target.value)}
                      onFocus={() => (produtoResults[item.key]?.length ?? 0) > 0 && setShowProdutoDropdown(item.key)}
                      className="w-full rounded-lg border bg-gray-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:bg-white"
                    />
                    {showProdutoDropdown === item.key && (produtoResults[item.key]?.length ?? 0) > 0 && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border bg-white shadow-xl max-h-48 overflow-y-auto">
                        {produtoResults[item.key].map(p => (
                          <button key={p.id} type="button" onClick={() => selectProduto(p, idx)}
                            className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-blue-50 text-sm border-b last:border-b-0">
                            <div>
                              <p className="font-medium text-gray-900">{p.name}</p>
                              <p className="text-xs text-gray-400">{p.internal_code || p.barcode || '---'} | NCM: {p.ncm || '---'}</p>
                            </div>
                            {p.sale_price != null && (
                              <span className="text-sm font-medium text-green-600">{formatCurrency(p.sale_price / 100)}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Item fields grid */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-12 sm:gap-2 sm:items-end">
                    <div className="col-span-2 sm:col-span-4">
                      <label className="block text-xs text-gray-500 mb-1">Descricao *</label>
                      <input type="text" value={item.descricao}
                        onChange={e => updateItem(idx, 'descricao', e.target.value)}
                        placeholder="Descricao do produto"
                        className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">NCM * <span className="text-gray-300">(8 dig.)</span></label>
                      <input type="text" value={item.ncm}
                        onChange={e => updateItem(idx, 'ncm', e.target.value.replace(/\D/g, '').slice(0, 8))}
                        placeholder="84433299"
                        maxLength={8}
                        className={cn(
                          'w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500 font-mono',
                          item.ncm && item.ncm.replace(/\D/g, '').length !== 8 && 'border-red-300 bg-red-50'
                        )} />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-xs text-gray-500 mb-1">Qtd *</label>
                      <input type="number" min={1} step={1} value={item.quantidade}
                        onChange={e => updateItem(idx, 'quantidade', Math.max(1, Number(e.target.value)))}
                        aria-label={`Quantidade item ${idx + 1}`}
                        className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">V. Unit. (R$) *</label>
                      <input type="text" value={item.valor_unitario_display}
                        onChange={e => updateItem(idx, 'valor_unitario_display', e.target.value)}
                        placeholder="0,00"
                        className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500" />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-xs text-gray-500 mb-1">Desconto</label>
                      <input type="text" value={item.desconto_display}
                        onChange={e => updateItem(idx, 'desconto_display', e.target.value)}
                        placeholder="0,00"
                        className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500" />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-xs text-gray-500 mb-1 sm:sr-only">Total</label>
                      <div className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-900 text-right">
                        {formatCurrency((item.valor_unitario * item.quantidade) - item.desconto)}
                      </div>
                    </div>
                    <div className="sm:col-span-1 flex items-end justify-end">
                      {items.length > 1 && (
                        <button type="button" onClick={() => removeItem(idx)}
                          aria-label={`Remover item ${idx + 1}`}
                          className="rounded-lg p-2 text-gray-400 hover:text-red-500 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Extra fields row */}
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">CFOP</label>
                      <input type="text" value={item.cfop}
                        onChange={e => updateItem(idx, 'cfop', e.target.value)}
                        placeholder={selectedNat?.cfop || '5102'}
                        className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500 font-mono" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Unidade</label>
                      <select value={item.unidade} onChange={e => updateItem(idx, 'unidade', e.target.value)}
                        aria-label={`Unidade item ${idx + 1}`}
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
                  </div>
                </div>
              ))}
            </div>

            {/* Running total */}
            <div className="mt-4 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-blue-600 font-medium">Total dos Produtos</p>
                  {totalDesconto > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Bruto: {formatCurrency(totalBruto)} — Desconto: -{formatCurrency(totalDesconto)}
                    </p>
                  )}
                </div>
                <span className="text-2xl font-bold text-blue-900">{formatCurrency(totalReais)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STEP 3: Transporte & Pagamento                 */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === 3 && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Frete */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Truck className="h-5 w-5 text-gray-400" />
              <h2 className="text-base font-semibold text-gray-900">Frete / Transporte</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {FRETE_OPTIONS.map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => setTransporte(prev => ({ ...prev, modalidade_frete: opt.value }))}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all',
                    transporte.modalidade_frete === opt.value
                      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                      : 'border-gray-200 hover:border-gray-300'
                  )}>
                  <CircleDot className={cn(
                    'h-5 w-5 shrink-0',
                    transporte.modalidade_frete === opt.value ? 'text-blue-600' : 'text-gray-300'
                  )} />
                  <div>
                    <p className={cn('text-sm font-semibold', transporte.modalidade_frete === opt.value ? 'text-blue-700' : 'text-gray-700')}>
                      {opt.label}
                    </p>
                    <p className="text-xs text-gray-400">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Transport details when freight is selected */}
            {transporte.modalidade_frete !== '9' && (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Dados da Transportadora</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-xs text-gray-500 mb-1">Nome</label>
                    <input type="text" value={transporte.transportadora_nome}
                      onChange={e => setTransporte(prev => ({ ...prev, transportadora_nome: e.target.value }))}
                      placeholder="Transportadora"
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">CNPJ</label>
                    <input type="text" value={transporte.transportadora_cnpj}
                      onChange={e => setTransporte(prev => ({ ...prev, transportadora_cnpj: e.target.value }))}
                      placeholder="00.000.000/0000-00"
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Placa</label>
                    <input type="text" value={transporte.placa}
                      onChange={e => setTransporte(prev => ({ ...prev, placa: e.target.value.toUpperCase() }))}
                      placeholder="ABC1D23"
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 uppercase" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Volumes</label>
                    <input type="text" value={transporte.volumes}
                      onChange={e => setTransporte(prev => ({ ...prev, volumes: e.target.value }))}
                      placeholder="1"
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Peso Bruto (kg)</label>
                    <input type="text" value={transporte.peso_bruto}
                      onChange={e => setTransporte(prev => ({ ...prev, peso_bruto: e.target.value }))}
                      placeholder="0,000"
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Pagamento */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-5 w-5 text-gray-400" />
              <h2 className="text-base font-semibold text-gray-900">Forma de Pagamento</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {PAGAMENTOS.map(pag => {
                const Icon = pag.icon
                const c = colorMap[pag.color]
                const selected = formaPagamento === pag.value
                return (
                  <button key={pag.value} type="button"
                    onClick={() => setFormaPagamento(pag.value)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all',
                      selected
                        ? `${c.bg} ${c.border} ring-2 ${c.ring}`
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    )}>
                    <div className={cn(
                      'h-9 w-9 rounded-lg flex items-center justify-center',
                      selected ? c.bgLight : 'bg-gray-100'
                    )}>
                      <Icon className={cn('h-4 w-4', selected ? c.icon : 'text-gray-400')} />
                    </div>
                    <div>
                      <p className={cn('text-sm font-semibold', selected ? c.text : 'text-gray-700')}>{pag.label}</p>
                    </div>
                    {selected && <CheckCircle2 className={cn('h-4 w-4 ml-auto', c.icon)} />}
                  </button>
                )
              })}
            </div>
            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Valor do pagamento</label>
              <div className="relative max-w-xs">
                <span className="absolute left-3 top-2.5 text-sm text-gray-400">R$</span>
                <input type="text" value={valorPagamento}
                  onChange={e => setValorPagamento(e.target.value)}
                  aria-label="Valor do pagamento"
                  placeholder="0,00"
                  className="w-full rounded-lg border py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold" />
              </div>
            </div>
          </div>

          {/* Info Adicionais */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Info className="h-5 w-5 text-gray-400" />
              <h2 className="text-base font-semibold text-gray-900">Informacoes Adicionais</h2>
            </div>
            <textarea
              rows={3}
              value={infoAdicionais}
              onChange={e => setInfoAdicionais(e.target.value)}
              placeholder="Informacoes complementares impressas na DANFE (opcional)..."
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-blue-500 resize-none"
            />
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* STEP 4: Revisao & Emissao                      */}
      {/* ═══════════════════════════════════════════════ */}
      {currentStep === 4 && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Emission in progress / result */}
          {(submitting || result) ? (
            <div className="rounded-xl border bg-white p-8 shadow-sm">
              {/* Emission progress phases */}
              {submitting && (
                <div className="space-y-5 max-w-md mx-auto">
                  <h2 className="text-lg font-semibold text-gray-900 text-center mb-6">Emitindo NF-e...</h2>
                  {[
                    { phase: 1, label: 'Assinando XML com certificado A1...' },
                    { phase: 2, label: 'Enviando a SEFAZ...' },
                    { phase: 3, label: 'Aguardando retorno...' },
                  ].map(step => (
                    <div key={step.phase} className={cn(
                      'flex items-center gap-3 rounded-lg px-4 py-3 transition-all',
                      emissionPhase === step.phase && 'bg-blue-50 border border-blue-200',
                      emissionPhase > step.phase && 'bg-green-50 border border-green-200',
                      emissionPhase < step.phase && 'bg-gray-50 border border-gray-100 opacity-50',
                    )}>
                      {emissionPhase > step.phase ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                      ) : emissionPhase === step.phase ? (
                        <Loader2 className="h-5 w-5 text-blue-500 animate-spin shrink-0" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-gray-300 shrink-0" />
                      )}
                      <span className={cn(
                        'text-sm font-medium',
                        emissionPhase === step.phase && 'text-blue-700',
                        emissionPhase > step.phase && 'text-green-700',
                        emissionPhase < step.phase && 'text-gray-400',
                      )}>{step.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Result display */}
              {result && !submitting && (
                <div className="max-w-lg mx-auto">
                  {result.status === 'AUTHORIZED' ? (
                    <div className="text-center">
                      <div className="mx-auto h-20 w-20 rounded-full bg-green-100 flex items-center justify-center mb-4">
                        <CheckCircle2 className="h-10 w-10 text-green-500" />
                      </div>
                      <h2 className="text-2xl font-bold text-gray-900 mb-1">NF-e Autorizada!</h2>
                      <p className="text-gray-500 mb-6">N. {result.numero}, Serie {result.serie}</p>
                      <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-sm text-left space-y-2 mb-6">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Protocolo</span>
                          <span className="font-mono font-medium">{result.protocolo}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Chave de Acesso</span>
                          <p className="font-mono text-xs break-all mt-0.5 text-gray-700">{result.chave_acesso}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        <Link href={`/api/fiscal/nfe/${result.id}/danfe`} target="_blank"
                          className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                          <Printer className="h-4 w-4" /> Imprimir DANFE
                        </Link>
                        <Link href={`/api/fiscal/nfe/${result.id}/xml`} target="_blank"
                          className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                          <Download className="h-4 w-4" /> Baixar XML
                        </Link>
                        <button type="button" onClick={resetForm}
                          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 shadow-sm">
                          <Plus className="h-4 w-4" /> Nova NF-e
                        </button>
                      </div>
                    </div>
                  ) : result.status === 'PROCESSING' ? (
                    <div className="text-center">
                      <div className="mx-auto h-20 w-20 rounded-full bg-yellow-100 flex items-center justify-center mb-4">
                        <Loader2 className="h-10 w-10 text-yellow-500 animate-spin" />
                      </div>
                      <h2 className="text-2xl font-bold text-gray-900 mb-1">Em Processamento</h2>
                      <p className="text-gray-500 mb-6">A SEFAZ esta processando sua nota. Consulte em breve.</p>
                      <div className="flex items-center justify-center gap-3">
                        <Link href="/fiscal/nfe"
                          className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                          <ArrowLeft className="h-4 w-4" /> Voltar para Lista
                        </Link>
                      </div>
                    </div>
                  ) : (
                    /* REJECTED or ERROR */
                    <div className="text-center">
                      <div className="mx-auto h-20 w-20 rounded-full bg-red-100 flex items-center justify-center mb-4">
                        <XCircle className="h-10 w-10 text-red-500" />
                      </div>
                      <h2 className="text-2xl font-bold text-gray-900 mb-1">NF-e Rejeitada</h2>
                      <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-left mb-6 mx-auto max-w-md">
                        <p className="font-medium text-red-800 mb-1">Motivo da Rejeicao:</p>
                        <p className="text-red-700">{result.motivo || 'Erro desconhecido'}</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        <button type="button" onClick={() => { setResult(null); setEmissionPhase(0); setCurrentStep(1) }}
                          className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-600 shadow-sm">
                          <RefreshCw className="h-4 w-4" /> Corrigir e Reenviar
                        </button>
                        <Link href="/fiscal/nfe"
                          className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                          <ArrowLeft className="h-4 w-4" /> Voltar para Lista
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Summary / Review */
            <div className="space-y-4">
              {/* Summary: Client & Natureza */}
              <div className="rounded-xl border bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Cabecalho</h3>
                  <button type="button" onClick={() => setCurrentStep(1)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Editar</button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-400">Cliente</p>
                    <p className="font-semibold">{selectedCliente?.legal_name || '---'}</p>
                    <p className="text-xs text-gray-500">{formatDocument(selectedCliente?.document_number)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Natureza da Operacao</p>
                    <p className="font-semibold">{selectedNat?.label}</p>
                    <span className="inline-block mt-0.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-600">
                      CFOP {selectedNat?.cfop}
                    </span>
                  </div>
                  {selectedCliente?.address_city && (
                    <div>
                      <p className="text-xs text-gray-400">Endereco</p>
                      <p className="font-medium text-gray-700">
                        {selectedCliente.address_street}, {selectedCliente.address_number} — {selectedCliente.address_city}/{selectedCliente.address_state}
                      </p>
                    </div>
                  )}
                  {chavesReferenciadas.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400">Chaves Referenciadas</p>
                      {chavesReferenciadas.map((ch, i) => (
                        <p key={i} className="font-mono text-xs text-gray-600 truncate">{ch}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Summary: Items */}
              <div className="rounded-xl border bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Itens ({items.length})</h3>
                  <button type="button" onClick={() => setCurrentStep(2)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Editar</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b">
                        <th className="text-left py-2 font-medium">Produto</th>
                        <th className="text-left py-2 font-medium">NCM</th>
                        <th className="text-right py-2 font-medium">Qtd</th>
                        <th className="text-right py-2 font-medium">V. Unit.</th>
                        <th className="text-right py-2 font-medium">Desc.</th>
                        <th className="text-right py-2 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => (
                        <tr key={item.key} className="border-b last:border-b-0">
                          <td className="py-2 font-medium text-gray-900 max-w-[200px] truncate">{item.descricao}</td>
                          <td className="py-2 font-mono text-gray-600">{item.ncm}</td>
                          <td className="py-2 text-right">{item.quantidade}</td>
                          <td className="py-2 text-right">{formatCurrency(item.valor_unitario)}</td>
                          <td className="py-2 text-right text-red-500">{item.desconto > 0 ? `-${formatCurrency(item.desconto)}` : '---'}</td>
                          <td className="py-2 text-right font-semibold">{formatCurrency((item.valor_unitario * item.quantidade) - item.desconto)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2">
                        <td colSpan={5} className="py-3 text-right font-semibold text-blue-800">Total NF-e</td>
                        <td className="py-3 text-right text-xl font-bold text-blue-900">{formatCurrency(totalReais)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Summary: Transport & Payment */}
              <div className="rounded-xl border bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Transporte & Pagamento</h3>
                  <button type="button" onClick={() => setCurrentStep(3)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Editar</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-400">Frete</p>
                    <p className="font-semibold">{FRETE_OPTIONS.find(f => f.value === transporte.modalidade_frete)?.label}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Pagamento</p>
                    <p className="font-semibold">{PAGAMENTOS.find(p => p.value === formaPagamento)?.label}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Valor Pagamento</p>
                    <p className="font-semibold">{formatCurrency(parseCurrencyInput(valorPagamento) || totalReais)}</p>
                  </div>
                  {transporte.modalidade_frete !== '9' && transporte.transportadora_nome && (
                    <div className="col-span-2">
                      <p className="text-xs text-gray-400">Transportadora</p>
                      <p className="font-medium">{transporte.transportadora_nome} {transporte.transportadora_cnpj && `(${transporte.transportadora_cnpj})`}</p>
                    </div>
                  )}
                  {infoAdicionais && (
                    <div className="col-span-2 sm:col-span-3">
                      <p className="text-xs text-gray-400">Info. Adicionais</p>
                      <p className="text-gray-700 text-sm">{infoAdicionais}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* EMIT BUTTON */}
              <div className="rounded-xl border-2 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-green-700 font-medium">Pronto para emitir</p>
                    <p className="text-3xl font-bold text-green-900 mt-1">{formatCurrency(totalReais)}</p>
                  </div>
                  <button type="button" onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="flex items-center gap-3 rounded-xl bg-green-600 px-8 py-4 text-base font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-200 transition-all hover:shadow-xl hover:shadow-green-300 active:scale-95">
                    <Send className="h-5 w-5" />
                    Emitir NF-e
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ Navigation Buttons ═══ */}
      {!submitting && !result && (
        <div className="flex items-center justify-between pt-2">
          <button type="button" onClick={goPrev}
            disabled={currentStep === 1}
            className="flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
            <ArrowLeft className="h-4 w-4" /> Anterior
          </button>
          {currentStep < 4 ? (
            <button type="button" onClick={goNext}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 shadow-sm transition-all active:scale-95">
              Proximo <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <div /> /* Empty spacer — step 4 has its own emit button */
          )}
        </div>
      )}
    </div>
  )
}
