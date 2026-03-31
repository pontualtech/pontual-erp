'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ArrowLeft, Edit, Camera, History, Info, Package, Plus, Trash2, Loader2, Search, Wrench, CreditCard, X, Printer, Mail, Send, Copy, FilePlus, User, Monitor, FileText, Clock, ChevronDown, ChevronUp, AlertTriangle, Save, Check, Layers, DollarSign, ExternalLink, Receipt } from 'lucide-react'

interface Customer {
  id: string; legal_name: string; trade_name: string | null; person_type: string
  document_number: string | null; email: string | null; phone: string | null
  mobile: string | null; address_city: string | null; address_state: string | null
}
interface OSItem {
  id: string; description: string | null; product_id: string | null
  quantity: number; unit_price: number; total_price: number; item_type: string
}
interface OSPhoto { id: string; photo_url: string; description: string | null; created_at: string }
interface OSHistoryEntry {
  id: string; from_status_id: string | null; to_status_id: string | null
  changed_by: string | null; changed_by_name: string | null; notes: string | null; created_at: string
}
interface StatusDef { id: string; name: string; color: string; order: number }
interface OSDetail {
  id: string; os_number: number; status_id: string; priority: string; os_type: string
  equipment_type: string | null; equipment_brand: string | null; equipment_model: string | null
  serial_number: string | null; reported_issue: string | null; diagnosis: string | null
  reception_notes: string | null; internal_notes: string | null
  estimated_cost: number; approved_cost: number; total_parts: number
  total_services: number; total_cost: number; warranty_until: string | null
  estimated_delivery: string | null; actual_delivery: string | null
  technician_id: string | null; payment_method: string | null
  created_at: string; updated_at: string; customers: Customer | null
  user_profiles: { id: string; name: string } | null
  service_order_items: OSItem[]; service_order_photos: OSPhoto[]
  service_order_history: OSHistoryEntry[]
  customer_id: string
  accounts_receivable?: AccountReceivable[]
}
interface AccountReceivableInstallment {
  id: string
  installment_number: number
  amount: number
  paid_amount: number | null
  due_date: string
  paid_at: string | null
  status: string
}
interface AccountReceivable {
  id: string
  description: string
  total_amount: number
  received_amount: number
  due_date: string
  status: string
  payment_method: string | null
  installment_count: number | null
  card_fee_total: number | null
  net_amount: number | null
  anticipated_at: string | null
  anticipation_fee: number | null
  anticipated_amount: number | null
  created_at: string
  updated_at: string | null
  installments: AccountReceivableInstallment[]
}
interface Produto { id: string; name: string; unit: string; sale_price: number; brand: string | null }

const priorityLabel: Record<string, string> = { LOW: 'Baixa', MEDIUM: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' }
const priorityColor: Record<string, string> = { LOW: 'text-gray-500', MEDIUM: 'text-blue-600', HIGH: 'text-orange-600', URGENT: 'text-red-600' }

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function OSDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [os, setOs] = useState<OSDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusMap, setStatusMap] = useState<Record<string, StatusDef>>({})
  const [statusList, setStatusList] = useState<StatusDef[]>([])
  const [transitioning, setTransitioning] = useState(false)

  // Item add form
  const [showAddItem, setShowAddItem] = useState(false)
  const [itemType, setItemType] = useState<'PECA' | 'SERVICO'>('SERVICO')
  const [itemSearch, setItemSearch] = useState('')
  const [itemResults, setItemResults] = useState<Produto[]>([])
  const [itemDesc, setItemDesc] = useState('')
  const [itemQty, setItemQty] = useState('1')
  const [itemPrice, setItemPrice] = useState('')
  const [itemProductId, setItemProductId] = useState<string | null>(null)
  const [addingItem, setAddingItem] = useState(false)
  const [deletingItem, setDeletingItem] = useState<string | null>(null)
  const [showQuickRegister, setShowQuickRegister] = useState(false)
  const [quickName, setQuickName] = useState('')
  const [quickPrice, setQuickPrice] = useState('')
  const [quickSaving, setQuickSaving] = useState(false)
  const [itemsAddedCount, setItemsAddedCount] = useState(0)
  const [showAddedCheck, setShowAddedCheck] = useState(false)

  // Kits
  const [kits, setKits] = useState<{ id: string; key: string; value: any }[]>([])
  const [showKitsPopover, setShowKitsPopover] = useState(false)
  const [applyingKit, setApplyingKit] = useState<string | null>(null)

  // Which section to add item to (serviços or peças)
  const [addItemSection, setAddItemSection] = useState<'SERVICO' | 'PECA'>('SERVICO')

  // Payment modal (for delivery/final status)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string; icon: string; active: boolean }[]>([])
  const [paymentMethodsLoaded, setPaymentMethodsLoaded] = useState(false)
  const [installmentCount, setInstallmentCount] = useState(1)
  const [cardFees, setCardFees] = useState<any[]>([])

  // Print/Email modal
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [printEmail, setPrintEmail] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)

  // NFS-e modal
  const [showNfseModal, setShowNfseModal] = useState(false)
  const [nfseDescription, setNfseDescription] = useState('')
  const [emittingNfse, setEmittingNfse] = useState(false)

  // Quote email modal
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [quoteEmail, setQuoteEmail] = useState('')
  const [quotePreviewHtml, setQuotePreviewHtml] = useState('')
  const [loadingQuotePreview, setLoadingQuotePreview] = useState(false)
  const [sendingQuote, setSendingQuote] = useState(false)

  // Editable text fields (auto-save on blur)
  const [editDiagnosis, setEditDiagnosis] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editInternalNotes, setEditInternalNotes] = useState('')
  const [savingField, setSavingField] = useState<string | null>(null)
  const [discountType, setDiscountType] = useState<'reais' | 'percent'>('reais')
  const [discountValue, setDiscountValue] = useState('')
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [editTechnicianId, setEditTechnicianId] = useState('')
  const [editPaymentMethod, setEditPaymentMethod] = useState('')
  const [editEstimatedDelivery, setEditEstimatedDelivery] = useState('')
  const [editActualDelivery, setEditActualDelivery] = useState('')
  const [savingAll, setSavingAll] = useState(false)
  const [financeiroExpanded, setFinanceiroExpanded] = useState(true)
  const [headerScrolled, setHeaderScrolled] = useState(false)
  const [originalValues, setOriginalValues] = useState({
    diagnosis: '', notes: '', internalNotes: '', technicianId: '', paymentMethod: '', estimatedDelivery: '', actualDelivery: '',
  })

  // Track scroll for header shadow
  useEffect(() => {
    function onScroll() { setHeaderScrolled(window.scrollY > 10) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function hasUnsavedChanges() {
    return editDiagnosis !== originalValues.diagnosis ||
      editNotes !== originalValues.notes ||
      editInternalNotes !== originalValues.internalNotes ||
      editTechnicianId !== originalValues.technicianId ||
      editPaymentMethod !== originalValues.paymentMethod ||
      editEstimatedDelivery !== originalValues.estimatedDelivery ||
      editActualDelivery !== originalValues.actualDelivery
  }

  function confirmLeave(): boolean {
    if (!hasUnsavedChanges()) return true
    return confirm('Você tem alterações não salvas. Deseja sair sem salvar?')
  }

  // Browser beforeunload (fechar aba/recarregar)
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (hasUnsavedChanges()) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  })

  // Esc = voltar para lista (com confirmação)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !showAddItem && !showPaymentModal) {
        if (confirmLeave()) router.push('/os')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router, showAddItem, showPaymentModal, originalValues, editDiagnosis, editNotes, editInternalNotes, editTechnicianId, editPaymentMethod, editEstimatedDelivery, editActualDelivery])

  // Pending status transition (for payment modal)
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null)

  function loadOS() {
    fetch(`/api/os/${id}`)
      .then(r => r.json())
      .then(d => {
        const data = d.data ?? null
        setOs(data)
        if (data) {
          const origDiag = data.diagnosis || ''
          const origNotes = data.reception_notes || ''
          const origInternal = data.internal_notes || ''
          const origTech = data.technician_id || ''
          const origPayment = data.payment_method || ''
          const origEstDel = data.estimated_delivery ? new Date(data.estimated_delivery).toISOString().split('T')[0] : ''
          const origActDel = data.actual_delivery ? new Date(data.actual_delivery).toISOString().split('T')[0] : ''
          setOriginalValues({ diagnosis: origDiag, notes: origNotes, internalNotes: origInternal, technicianId: origTech, paymentMethod: origPayment, estimatedDelivery: origEstDel, actualDelivery: origActDel })
          setEditDiagnosis(origDiag)
          setEditNotes(origNotes)
          setEditInternalNotes(data.internal_notes || '')
          setEditTechnicianId(data.technician_id || '')
          setEditPaymentMethod(data.payment_method || '')
          setEditEstimatedDelivery(data.estimated_delivery ? new Date(data.estimated_delivery).toISOString().split('T')[0] : '')
          setEditActualDelivery(data.actual_delivery ? new Date(data.actual_delivery).toISOString().split('T')[0] : '')
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(d => setUsers(d.data ?? [])).catch(() => {})
    fetch('/api/financeiro/formas-pagamento').then(r => r.json()).then(d => {
      setPaymentMethods((d.data ?? []).filter((m: any) => m.active))
      setPaymentMethodsLoaded(true)
    }).catch(() => {})
    fetch('/api/financeiro/card-fees').then(r => r.json()).then(d => setCardFees(d.data ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/status?module=os')
      .then(r => r.json())
      .then(d => {
        const cols: StatusDef[] = d.data ?? []
        setStatusList(cols)
        const map: Record<string, StatusDef> = {}
        cols.forEach(col => { map[col.id] = col })
        setStatusMap(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => { loadOS() }, [id])

  // Search products/services for items
  const searchProdutos = useCallback((q: string) => {
    if (q.length < 2) { setItemResults([]); return }
    const type = itemType === 'PECA' ? 'produto' : 'servico'
    fetch(`/api/produtos?search=${encodeURIComponent(q)}&type=${type}&limit=8`)
      .then(r => r.json())
      .then(d => setItemResults(d.data ?? []))
      .catch(() => {})
  }, [itemType])

  useEffect(() => {
    const t = setTimeout(() => searchProdutos(itemSearch), 300)
    return () => clearTimeout(t)
  }, [itemSearch, searchProdutos])

  function selectProduct(p: Produto) {
    setItemDesc(p.name + (p.brand ? ` (${p.brand})` : ''))
    setItemPrice(String(p.sale_price / 100))
    setItemProductId(p.id)
    setItemResults([])
    setItemSearch('')
  }

  async function handleAddItem(closeAfter: boolean = false) {
    if (!itemDesc.trim()) { toast.error('Descricao e obrigatoria'); return }
    const qty = parseInt(itemQty) || 1
    const price = Math.round(parseFloat(itemPrice || '0') * 100)

    setAddingItem(true)
    try {
      const res = await fetch(`/api/os/${id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_type: itemType,
          product_id: itemProductId,
          description: itemDesc.trim(),
          quantity: qty,
          unit_price: price,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao adicionar item')

      setItemsAddedCount(prev => prev + 1)
      setItemDesc(''); setItemQty('1'); setItemPrice(''); setItemProductId(null)
      setItemSearch(''); setItemResults([])

      // Show green check briefly
      setShowAddedCheck(true)
      setTimeout(() => setShowAddedCheck(false), 2000)

      if (closeAfter) {
        setShowAddItem(false)
        setItemsAddedCount(0)
        toast.success('Item adicionado!')
      }
      loadOS()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setAddingItem(false)
    }
  }

  async function handleDeleteItem(itemId: string) {
    setDeletingItem(itemId)
    try {
      const res = await fetch(`/api/os/${id}/items`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Item removido')
      loadOS()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setDeletingItem(null)
    }
  }

  async function handleQuickRegister() {
    if (!quickName.trim()) { toast.error('Nome e obrigatorio'); return }
    setQuickSaving(true)
    try {
      const payload = {
        name: quickName.trim(),
        unit: itemType === 'SERVICO' ? 'SV' : 'UN',
        sale_price: Math.round(parseFloat(quickPrice || '0') * 100),
        cost_price: 0,
      }
      const res = await fetch('/api/produtos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')

      const p = data.data
      setItemDesc(p.name)
      setItemPrice(String(p.sale_price / 100))
      setItemProductId(p.id)
      setShowQuickRegister(false)
      setQuickName('')
      setQuickPrice('')
      toast.success(`${itemType === 'SERVICO' ? 'Servico' : 'Produto'} cadastrado e selecionado!`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setQuickSaving(false)
    }
  }

  function loadKits() {
    fetch('/api/kits').then(r => r.json()).then(d => setKits(d.data ?? [])).catch(() => {})
  }

  useEffect(() => { loadKits() }, [])

  async function handleApplyKit(kitKey: string, kitName: string) {
    setApplyingKit(kitKey)
    try {
      const res = await fetch(`/api/os/${id}/apply-kit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kit_id: kitKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao aplicar kit')
      const count = data.data?.length ?? 0
      toast.success(`Kit aplicado: ${count} ${count === 1 ? 'item adicionado' : 'itens adicionados'}`)
      setShowKitsPopover(false)
      loadOS()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao aplicar kit')
    } finally {
      setApplyingKit(null)
    }
  }

  function handlePrintOnly() {
    window.open(`/api/os/${id}/pdf`, '_blank')
    setShowPrintModal(false)
  }

  async function handleSendEmail() {
    setSendingEmail(true)
    try {
      const res = await fetch(`/api/os/${id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: printEmail || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar email')
      toast.success(`Email enviado para ${data.data?.to || printEmail}!`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar email')
    } finally {
      setSendingEmail(false)
    }
  }

  function handlePrintAndEmail() {
    window.open(`/api/os/${id}/pdf`, '_blank')
    handleSendEmail()
    setShowPrintModal(false)
  }

  function handleEmailOnly() {
    handleSendEmail()
    setShowPrintModal(false)
  }

  function openPrintModal() {
    setPrintEmail(os?.customers?.email || '')
    setShowPrintModal(true)
  }

  async function openNfseModal() {
    if (!os) return

    // Buscar template de discriminação e garantia das configurações
    let template = 'Reparo em {{equipamento}} marca {{marca}} modelo {{modelo}}, numero de serie {{serie}}, conforme ordem de servico numero {{os_number}}. Garantia {{garantia}} dias.'
    let garantiaDias = '90'
    try {
      const res = await fetch('/api/settings/nfse-template')
      if (res.ok) {
        const data = await res.json()
        if (data.template) template = data.template
        if (data.garantia_dias) garantiaDias = data.garantia_dias
      }
    } catch {}

    // Montar itens da OS
    const itens = (os.service_order_items || [])
      .map((i: OSItem) => `- ${i.description} (${i.quantity}x R$ ${(i.unit_price / 100).toFixed(2)})`)
      .join('\n')

    // Substituir variáveis no template
    const discriminacao = template
      .replace(/\{\{equipamento\}\}/g, os.equipment_type || 'Impressora')
      .replace(/\{\{marca\}\}/g, os.equipment_brand || '')
      .replace(/\{\{modelo\}\}/g, os.equipment_model || '')
      .replace(/\{\{serie\}\}/g, os.serial_number || 'N/A')
      .replace(/\{\{os_number\}\}/g, String(os.os_number))
      .replace(/\{\{garantia\}\}/g, garantiaDias)
      .replace(/\{\{cliente\}\}/g, os.customers?.legal_name || '')
      .replace(/\{\{itens\}\}/g, itens)
      .replace(/\{\{valor\}\}/g, `R$ ${(os.total_cost / 100).toFixed(2)}`)
      .replace(/\s+/g, ' ').trim()

    setNfseDescription(discriminacao)
    setShowNfseModal(true)
  }

  async function handleEmitirNfse() {
    if (!os || emittingNfse) return
    if (os.total_cost <= 0) { toast.error('OS sem valor. Adicione itens antes de emitir NFS-e.'); return }
    if (!os.customers?.document_number) { toast.error('Cliente sem CPF/CNPJ cadastrado.'); return }

    setEmittingNfse(true)
    try {
      const res = await fetch('/api/fiscal/emitir-nfse-sp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: os.customer_id,
          service_order_id: id,
          description: nfseDescription,
          service_code: '07498',
          total_amount: os.total_cost,
          aliquota_iss: 0.05,
          iss_retido: false,
        }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`NFS-e #${data.numero_nfse} emitida e enviada por email ao cliente!`)
        setShowNfseModal(false)
        if (data.link_nfse) window.open(data.link_nfse, '_blank')
        loadOS() // recarregar para atualizar status
      } else {
        const erroMsg = data.erros?.map((e: any) => `[${e.codigo}] ${e.mensagem}`).join('\n') || data.error || 'Erro ao emitir NFS-e'
        toast.error(erroMsg)
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao emitir NFS-e')
    } finally {
      setEmittingNfse(false)
    }
  }

  async function openQuoteModal() {
    setQuoteEmail(os?.customers?.email || '')
    setQuotePreviewHtml('')
    setShowQuoteModal(true)
    setLoadingQuotePreview(true)
    try {
      const res = await fetch(`/api/os/${id}/enviar-orcamento`)
      if (res.ok) {
        const html = await res.text()
        setQuotePreviewHtml(html)
      } else {
        toast.error('Erro ao carregar preview do orcamento')
      }
    } catch {
      toast.error('Erro ao carregar preview')
    } finally {
      setLoadingQuotePreview(false)
    }
  }

  async function handleSendQuote() {
    if (!quoteEmail) { toast.error('Informe o email do destinatario'); return }
    setSendingQuote(true)
    try {
      const res = await fetch(`/api/os/${id}/enviar-orcamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: quoteEmail }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar orcamento')
      toast.success(`Orcamento enviado para ${quoteEmail}!`)
      setShowQuoteModal(false)
      loadOS()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar orcamento')
    } finally {
      setSendingQuote(false)
    }
  }

  function getNextStatus(): StatusDef | null {
    if (!os) return null
    const current = statusMap[os.status_id]
    if (!current) return null
    return statusList.find(s => s.order === current.order + 1) ?? null
  }

  function handleAdvanceClick() {
    const next = getNextStatus()
    if (!os || !next) return
    const isDelivery = next.name.toLowerCase().includes('entreg') && !next.name.toLowerCase().includes('recusado')
    if (isDelivery && os.total_cost > 0) {
      setPaymentMethod('')
      setPaymentNotes('')
      setInstallmentCount(1)
      setPendingStatusId(next.id)
      if (!paymentMethodsLoaded) {
        fetch('/api/financeiro/formas-pagamento').then(r => r.json()).then(d => {
          const methods = (d.data ?? []).filter((m: any) => m.active)
          setPaymentMethods(methods)
          setPaymentMethodsLoaded(true)
        }).catch(() => {})
      }
      setShowPaymentModal(true)
    } else {
      doTransition(next.id)
    }
  }

  async function doTransition(toStatusId: string, payment_method?: string, notes?: string, installments?: number) {
    setTransitioning(true)
    try {
      const body: any = { toStatusId }
      if (payment_method) body.payment_method = payment_method
      if (notes) body.notes = notes
      if (installments && installments > 1) body.installment_count = installments
      if (editTechnicianId) body.technician_id = editTechnicianId
      const res = await fetch(`/api/os/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro na transicao')
      if (data.data?.receivable_created) {
        toast.success('OS finalizada! Conta a receber gerada automaticamente.')
      }
      setShowPaymentModal(false)
      setPendingStatusId(null)
      loadOS()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally { setTransitioning(false) }
  }

  async function handleConfirmDelivery() {
    if (!paymentMethod) { toast.error('Selecione a forma de pagamento'); return }
    const targetId = pendingStatusId || getNextStatus()?.id
    if (!targetId) return
    doTransition(targetId, paymentMethod, paymentNotes || undefined, installmentCount)
  }

  // Check if selected payment method is a card type
  const isCardPayment = /cart[aã]o|cr[eé]dito|credito/i.test(paymentMethod)

  // Calculate card fee for current installment selection
  function getCardFeePct(): number {
    if (!isCardPayment || cardFees.length === 0) return 0
    const range = cardFees[0]?.installments?.find((r: any) => installmentCount >= r.from && installmentCount <= r.to)
    return range?.fee_pct || 0
  }

  // Save all editable fields at once
  async function handleSaveAll() {
    if (!os) return
    setSavingAll(true)
    try {
      // Only send fields that exist in the ServiceOrder schema
      const payload: any = {
        diagnosis: editDiagnosis || null,
        reception_notes: editNotes || null,
        internal_notes: editInternalNotes || null,
        technician_id: editTechnicianId || null,
        payment_method: editPaymentMethod || null,
        estimated_delivery: editEstimatedDelivery ? new Date(editEstimatedDelivery).toISOString() : null,
        actual_delivery: editActualDelivery ? new Date(editActualDelivery).toISOString() : null,
      }
      const res = await fetch(`/api/os/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro ao salvar') }
      toast.success('OS salva com sucesso!')
      setOriginalValues({
        diagnosis: editDiagnosis, notes: editNotes, internalNotes: editInternalNotes,
        technicianId: editTechnicianId, paymentMethod: editPaymentMethod,
        estimatedDelivery: editEstimatedDelivery, actualDelivery: editActualDelivery,
      })
      loadOS()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSavingAll(false)
    }
  }

  function openAddItem(section: 'SERVICO' | 'PECA') {
    setAddItemSection(section)
    setItemType(section)
    setShowAddItem(true)
    setItemSearch('')
    setItemResults([])
    setItemDesc('')
    setItemQty('1')
    setItemPrice('')
    setItemProductId(null)
    setShowQuickRegister(false)
    setItemsAddedCount(0)
    setShowAddedCheck(false)
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>
  if (!os) return <p className="p-6 text-red-500">OS nao encontrada</p>

  const currentStatus = statusMap[os.status_id]
  const items = os.service_order_items ?? []
  const pecas = items.filter(i => i.item_type === 'PECA')
  const servicos = items.filter(i => i.item_type !== 'PECA')
  const discount = 0 // placeholder for future discount field

  return (
    <div className="space-y-5 pb-8">
      {/* ========== HEADER (sticky) ========== */}
      <div className={cn(
        'flex flex-wrap items-center justify-between gap-3 sticky top-0 z-10 bg-gray-50/95 dark:bg-gray-900/95 -mx-6 px-6 py-3 -mt-3 transition-shadow duration-200',
        headerScrolled ? 'shadow-md border-b border-gray-200' : 'border-b border-transparent'
      )} style={{ backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight font-mono">
            OS-{String(os.os_number).padStart(4, '0')}
          </h1>
          {currentStatus && (
            <select
              value={os.status_id}
              disabled={transitioning}
              title="Alterar status"
              onChange={e => {
                const targetId = e.target.value
                const target = statusList.find(s => s.id === targetId)
                if (!target || targetId === os.status_id) return
                const isDelivery = target.name.toLowerCase().includes('entreg') && !target.name.toLowerCase().includes('recusado')
                if (isDelivery && (os.total_cost ?? 0) > 0) {
                  setPaymentMethod('')
                  setPaymentNotes('')
                  setInstallmentCount(1)
                  setPendingStatusId(targetId)
                  if (!paymentMethodsLoaded) {
                    fetch('/api/financeiro/formas-pagamento').then(r => r.json()).then(d => {
                      setPaymentMethods((d.data ?? []).filter((m: any) => m.active))
                      setPaymentMethodsLoaded(true)
                    }).catch(() => {})
                  }
                  setShowPaymentModal(true)
                } else {
                  doTransition(targetId)
                }
              }}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-white border-0 cursor-pointer appearance-none pr-7 shadow-sm"
              style={{
                backgroundColor: currentStatus.color,
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 8px center',
              }}
            >
              {statusList.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          {transitioning && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={openQuoteModal}
            className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors">
            <Send className="h-4 w-4" /> Enviar Orcamento
          </button>
          <button type="button" onClick={openNfseModal}
            className="flex items-center gap-1.5 rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors">
            <Receipt className="h-4 w-4" /> Emitir NFS-e
          </button>
          <button type="button" onClick={openPrintModal}
            className="flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors">
            <Printer className="h-4 w-4" /> Imprimir
          </button>
          <Link href={`/os/novo?cliente=${os.customer_id || ''}`}
            className="flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors"
            title="Criar nova OS para o mesmo cliente">
            <FilePlus className="h-4 w-4" /> Nova OS
          </Link>
          <Link href={`/os/novo?clonar=${id}`}
            className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors"
            title="Clonar esta OS com todos os dados">
            <Copy className="h-4 w-4" /> Clonar
          </Link>
          <Link href={`/os/${id}/editar`}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-gray-50 transition-colors">
            <Edit className="h-4 w-4" /> Editar
          </Link>
          <button type="button" onClick={() => { if (confirmLeave()) router.push('/os') }}
            className="rounded-lg border px-3 py-1.5 hover:bg-gray-100 transition-colors flex items-center gap-1.5 text-sm text-gray-600">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
        </div>
      </div>

      {/* ========== PAID BANNER (if OS is paid) ========== */}
      {(() => {
        const ar = (os.accounts_receivable ?? [])[0]
        if (!ar || (ar.status !== 'RECEBIDO' && ar.status !== 'PAGO')) return null
        const paidDate = ar.updated_at ? new Date(ar.updated_at).toLocaleDateString('pt-BR') : ''
        return (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-2 text-sm font-medium text-green-800">
            <Check className="h-5 w-5 text-green-600 shrink-0" />
            <span>OS paga {ar.payment_method ? `\u2014 ${ar.payment_method}` : ''} {fmt(ar.total_amount)} {paidDate ? `em ${paidDate}` : ''}</span>
          </div>
        )
      })()}

      {/* ========== CLIENT + EQUIPMENT (side by side) ========== */}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        {/* Client */}
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-blue-100">
              <User className="h-4 w-4 text-blue-600" />
            </div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Dados do Cliente</h2>
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-400 uppercase w-16 shrink-0">Nome</span>
              <span className="text-sm font-medium text-gray-900 text-right">{os.customers?.legal_name ?? '--'}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-400 uppercase w-16 shrink-0">Tel</span>
              <span className="text-sm text-gray-700 text-right">{os.customers?.mobile || os.customers?.phone || '--'}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-400 uppercase w-16 shrink-0">Email</span>
              <span className="text-sm text-gray-700 text-right truncate max-w-[220px]">{os.customers?.email || '--'}</span>
            </div>
            {os.customers?.address_city && (
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-gray-400 uppercase w-16 shrink-0">Cidade</span>
                <span className="text-sm text-gray-700 text-right">{os.customers.address_city}{os.customers.address_state ? ` / ${os.customers.address_state}` : ''}</span>
              </div>
            )}
            {os.customer_id && (
              <Link href={`/clientes/${os.customer_id}`} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-1">
                <User className="h-3 w-3" /> Ver cliente
              </Link>
            )}
          </div>
        </div>

        {/* Equipment */}
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-purple-100">
              <Monitor className="h-4 w-4 text-purple-600" />
            </div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Equipamento</h2>
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-400 uppercase w-16 shrink-0">Tipo</span>
              <span className="text-sm font-medium text-gray-900 text-right">{os.equipment_type || '--'}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-400 uppercase w-16 shrink-0">Marca</span>
              <span className="text-sm text-gray-700 text-right">{os.equipment_brand || '--'}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-400 uppercase w-16 shrink-0">Modelo</span>
              <span className="text-sm text-gray-700 text-right">{os.equipment_model || '--'}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-400 uppercase w-16 shrink-0">S/N</span>
              <span className="text-sm text-gray-700 text-right font-mono">{os.serial_number || '--'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ========== PROBLEMA / DIAGNOSTICO ========== */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-red-100">
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Problema / Diagnostico</h2>
        </div>
        <div className="space-y-3">
          {/* Reported issue (read-only) */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase mb-1">Defeito Relatado</label>
            <div className="text-sm text-gray-900 bg-gray-50 rounded-lg p-3 min-h-[40px]">
              {os.reported_issue || '--'}
            </div>
          </div>

          {/* Diagnosis (editable) */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 uppercase mb-1">
              Diagnostico
              {savingField === 'diagnosis' && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
            </label>
            <textarea
              value={editDiagnosis}
              onChange={e => setEditDiagnosis(e.target.value)}
              placeholder="Descreva o diagnostico..."
              rows={4}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 resize-y transition-colors"
            />
          </div>

          {/* Notes (editable) */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 uppercase mb-1">
              Observacoes
              {savingField === 'reception_notes' && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
            </label>
            <textarea
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              placeholder="Observacoes gerais..."
              rows={4}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 resize-y transition-colors"
            />
          </div>

          {/* Internal notes (editable, yellow bg) */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-yellow-600 uppercase mb-1">
              Obs. Internas (somente equipe)
              {savingField === 'internal_notes' && <Loader2 className="h-3 w-3 animate-spin text-yellow-600" />}
            </label>
            <textarea
              value={editInternalNotes}
              onChange={e => setEditInternalNotes(e.target.value)}
              placeholder="Anotacoes internas..."
              rows={4}
              className="w-full px-3 py-2 border border-yellow-300 rounded-lg text-sm bg-yellow-50 focus:border-yellow-500 focus:ring-1 focus:ring-yellow-200 resize-y transition-colors"
            />
          </div>
        </div>
      </div>

      {/* ========== SERVICOS ========== */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="flex items-center justify-between p-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-amber-100">
              <Wrench className="h-4 w-4 text-amber-600" />
            </div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Servicos ({servicos.length})</h2>
          </div>
          <div className="flex items-center gap-2">
            {(!showAddItem || addItemSection !== 'SERVICO') && (
              <button type="button" onClick={() => openAddItem('SERVICO')}
                className="flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors">
                <Plus className="h-3.5 w-3.5" /> Adicionar servico
              </button>
            )}
            <div className="relative">
              <button type="button" onClick={() => setShowKitsPopover(!showKitsPopover)}
                className="flex items-center gap-1.5 rounded-lg bg-purple-50 border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 transition-colors">
                <Layers className="h-3.5 w-3.5" /> Aplicar Kit
              </button>
              {showKitsPopover && (
                <div className="absolute right-0 z-20 mt-1 w-72 bg-white border rounded-lg shadow-lg">
                  <div className="p-2 border-b">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Kits disponiveis</p>
                  </div>
                  {kits.length === 0 ? (
                    <div className="p-4 text-center text-sm text-gray-400">
                      Nenhum kit cadastrado.
                      <a href="/config/kits" className="block mt-1 text-purple-600 hover:underline text-xs">Criar kit</a>
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto">
                      {kits.map(kit => {
                        const kitData = typeof kit.value === 'string' ? JSON.parse(kit.value) : kit.value
                        const itemCount = kitData.items?.length ?? 0
                        const totalValue = (kitData.items ?? []).reduce((s: number, i: any) => s + (i.unit_price * (i.quantity || 1)), 0)
                        return (
                          <button key={kit.id} type="button"
                            onClick={() => handleApplyKit(kit.key, kitData.name)}
                            disabled={applyingKit === kit.key}
                            className="w-full text-left px-3 py-2.5 hover:bg-purple-50 text-sm flex items-center justify-between border-b last:border-b-0 disabled:opacity-50">
                            <div>
                              <p className="font-medium text-gray-900">{kitData.name}</p>
                              <p className="text-xs text-gray-500">{itemCount} {itemCount === 1 ? 'item' : 'itens'} &middot; {fmt(totalValue)}</p>
                            </div>
                            {applyingKit === kit.key ? (
                              <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                            ) : (
                              <Plus className="h-4 w-4 text-purple-400" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Servicos table */}
        {servicos.length > 0 && (
          <div className="px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase text-gray-400">
                  <th className="pb-2 w-8 text-center">#</th>
                  <th className="pb-2">Servico / Codigo</th>
                  <th className="pb-2 w-20 text-right">Qtd</th>
                  <th className="pb-2 w-28 text-right">V.Unit</th>
                  <th className="pb-2 w-28 text-right">Total</th>
                  <th className="pb-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {servicos.map((item, idx) => (
                  <tr key={item.id} className="group hover:bg-amber-50/30 transition-colors">
                    <td className="py-2.5 text-center text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-2.5">{item.description || '--'}</td>
                    <td className="py-2.5 text-right">{item.quantity}</td>
                    <td className="py-2.5 text-right text-gray-500">{fmt(item.unit_price)}</td>
                    <td className="py-2.5 text-right font-medium">{fmt(item.total_price)}</td>
                    <td className="py-2.5 text-right">
                      <button type="button" onClick={() => handleDeleteItem(item.id)} title="Remover"
                        disabled={deletingItem === item.id}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50 transition-opacity">
                        {deletingItem === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td colSpan={4} className="py-2 text-right text-gray-500 text-xs uppercase">Subtotal Servicos</td>
                  <td className="py-2 text-right font-semibold text-amber-700">{fmt(os.total_services)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {servicos.length === 0 && (!showAddItem || addItemSection !== 'SERVICO') && (
          <div className="px-4 pb-4 text-center py-6 text-gray-400 text-sm">
            Nenhum servico adicionado
          </div>
        )}

        {/* Inline add form for Servicos */}
        {showAddItem && addItemSection === 'SERVICO' && (
          <div className="mx-4 mb-4 mt-2">
            <InlineAddItemForm
              itemType={itemType}
              setItemType={setItemType}
              itemSearch={itemSearch}
              setItemSearch={setItemSearch}
              itemResults={itemResults}
              setItemResults={setItemResults}
              selectProduct={selectProduct}
              showQuickRegister={showQuickRegister}
              setShowQuickRegister={setShowQuickRegister}
              quickName={quickName}
              setQuickName={setQuickName}
              quickPrice={quickPrice}
              setQuickPrice={setQuickPrice}
              quickSaving={quickSaving}
              handleQuickRegister={handleQuickRegister}
              itemDesc={itemDesc}
              setItemDesc={setItemDesc}
              itemQty={itemQty}
              setItemQty={setItemQty}
              itemPrice={itemPrice}
              setItemPrice={setItemPrice}
              setItemProductId={setItemProductId}
              addingItem={addingItem}
              handleAddItem={handleAddItem}
              onCancel={() => { setShowAddItem(false); setItemsAddedCount(0) }}
              sectionType="SERVICO"
              itemsAddedCount={itemsAddedCount}
              showAddedCheck={showAddedCheck}
            />
          </div>
        )}
      </div>

      {/* ========== PRODUTOS / PECAS ========== */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="flex items-center justify-between p-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-blue-100">
              <Package className="h-4 w-4 text-blue-600" />
            </div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Produtos / Pecas ({pecas.length})</h2>
          </div>
          {(!showAddItem || addItemSection !== 'PECA') && (
            <button type="button" onClick={() => openAddItem('PECA')}
              className="flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors">
              <Plus className="h-3.5 w-3.5" /> Adicionar produto
            </button>
          )}
        </div>

        {/* Pecas table */}
        {pecas.length > 0 && (
          <div className="px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase text-gray-400">
                  <th className="pb-2 w-8 text-center">#</th>
                  <th className="pb-2">Produto / Codigo</th>
                  <th className="pb-2 w-20 text-right">Qtd</th>
                  <th className="pb-2 w-28 text-right">V.Unit</th>
                  <th className="pb-2 w-28 text-right">Total</th>
                  <th className="pb-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pecas.map((item, idx) => (
                  <tr key={item.id} className="group hover:bg-blue-50/30 transition-colors">
                    <td className="py-2.5 text-center text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-2.5">{item.description || '--'}</td>
                    <td className="py-2.5 text-right">{item.quantity}</td>
                    <td className="py-2.5 text-right text-gray-500">{fmt(item.unit_price)}</td>
                    <td className="py-2.5 text-right font-medium">{fmt(item.total_price)}</td>
                    <td className="py-2.5 text-right">
                      <button type="button" onClick={() => handleDeleteItem(item.id)} title="Remover"
                        disabled={deletingItem === item.id}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50 transition-opacity">
                        {deletingItem === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td colSpan={4} className="py-2 text-right text-gray-500 text-xs uppercase">Subtotal Pecas</td>
                  <td className="py-2 text-right font-semibold text-blue-700">{fmt(os.total_parts)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {pecas.length === 0 && (!showAddItem || addItemSection !== 'PECA') && (
          <div className="px-4 pb-4 text-center py-6 text-gray-400 text-sm">
            Nenhum produto adicionado
          </div>
        )}

        {/* Inline add form for Pecas */}
        {showAddItem && addItemSection === 'PECA' && (
          <div className="mx-4 mb-4 mt-2">
            <InlineAddItemForm
              itemType={itemType}
              setItemType={setItemType}
              itemSearch={itemSearch}
              setItemSearch={setItemSearch}
              itemResults={itemResults}
              setItemResults={setItemResults}
              selectProduct={selectProduct}
              showQuickRegister={showQuickRegister}
              setShowQuickRegister={setShowQuickRegister}
              quickName={quickName}
              setQuickName={setQuickName}
              quickPrice={quickPrice}
              setQuickPrice={setQuickPrice}
              quickSaving={quickSaving}
              handleQuickRegister={handleQuickRegister}
              itemDesc={itemDesc}
              setItemDesc={setItemDesc}
              itemQty={itemQty}
              setItemQty={setItemQty}
              itemPrice={itemPrice}
              setItemPrice={setItemPrice}
              setItemProductId={setItemProductId}
              addingItem={addingItem}
              handleAddItem={handleAddItem}
              onCancel={() => { setShowAddItem(false); setItemsAddedCount(0) }}
              sectionType="PECA"
              itemsAddedCount={itemsAddedCount}
              showAddedCheck={showAddedCheck}
            />
          </div>
        )}
      </div>

      {/* ========== TOTALS + DESCONTO ========== */}
      {(() => {
        const subtotal = (os.total_services ?? 0) + (os.total_parts ?? 0)
        const discountAmt = discountType === 'percent'
          ? Math.round(subtotal * (parseFloat(discountValue || '0') / 100))
          : Math.round(parseFloat(discountValue || '0') * 100)
        const totalFinal = Math.max(0, subtotal - discountAmt)
        return (
          <div className="rounded-xl border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-white p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap gap-6">
                <div className="text-center">
                  <p className="text-xs text-gray-500 uppercase font-medium">Serviços</p>
                  <p className="text-lg font-bold text-amber-700">{fmt(os.total_services)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500 uppercase font-medium">Peças</p>
                  <p className="text-lg font-bold text-blue-700">{fmt(os.total_parts)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium mb-1">Desconto</p>
                  <div className="flex items-center gap-1">
                    <input type="number" min="0" step="0.01" value={discountValue}
                      onChange={e => setDiscountValue(e.target.value)}
                      placeholder="0" className="w-20 px-2 py-1 border rounded text-sm text-right" />
                    <select value={discountType} onChange={e => setDiscountType(e.target.value as any)}
                      title="Tipo de desconto" className="px-1 py-1 border rounded text-xs bg-white">
                      <option value="reais">R$</option>
                      <option value="percent">%</option>
                    </select>
                  </div>
                  {discountAmt > 0 && <p className="text-xs text-red-500 mt-0.5">-{fmt(discountAmt)}</p>}
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-blue-600 uppercase font-semibold">Total da OS</p>
                <p className="text-3xl font-extrabold text-blue-700">{fmt(totalFinal)}</p>
              </div>
            </div>

            {/* Técnico + Forma Pagamento + Data Execução */}
            <div className="border-t border-blue-100 pt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Técnico Responsável</label>
                <select value={editTechnicianId} title="Técnico"
                  onChange={e => setEditTechnicianId(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm bg-white">
                  <option value="">Não atribuído</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Forma de Pagamento</label>
                <select value={editPaymentMethod} title="Forma de pagamento"
                  onChange={e => setEditPaymentMethod(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm bg-white">
                  <option value="">—</option>
                  {paymentMethods.map(pm => <option key={pm.id} value={pm.name}>{pm.icon} {pm.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Data Execução</label>
                <input type="date" value={editActualDelivery} title="Data de execução"
                  onChange={e => setEditActualDelivery(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase font-medium mb-1">Data Previsão</label>
                <input type="date" value={editEstimatedDelivery} title="Data de previsão"
                  onChange={e => setEditEstimatedDelivery(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm" />
              </div>
            </div>
          </div>
        )
      })()}

      {/* ========== SAVE + BACK BUTTONS ========== */}
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => { if (confirmLeave()) router.push('/os') }}
          className="px-5 py-2.5 border rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar para lista
        </button>
        <button type="button" onClick={handleSaveAll} disabled={savingAll}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors flex items-center gap-2 shadow-sm">
          {savingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {savingAll ? 'Salvando...' : 'Salvar OS'}
        </button>
      </div>

      {/* ========== FINANCEIRO ========== */}
      {(os.accounts_receivable ?? []).length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setFinanceiroExpanded(!financeiroExpanded)}
            className="flex items-center justify-between w-full p-4"
          >
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-emerald-100">
                <DollarSign className="h-4 w-4 text-emerald-600" />
              </div>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Financeiro ({os.accounts_receivable!.length})
              </h2>
            </div>
            {financeiroExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>

          {financeiroExpanded && (
            <div className="px-4 pb-4 space-y-3">
              {os.accounts_receivable!.map(ar => {
                const isOverdue = ar.status === 'PENDENTE' && new Date(ar.due_date) < new Date()
                const isPaid = ar.status === 'RECEBIDO'
                const isCancelled = ar.status === 'CANCELADO'
                const remaining = ar.total_amount - ar.received_amount

                const statusBadgeClass = isPaid
                  ? 'bg-green-100 text-green-700'
                  : isCancelled
                    ? 'bg-gray-100 text-gray-500'
                    : isOverdue
                      ? 'bg-red-100 text-red-700'
                      : 'bg-amber-100 text-amber-700'
                const statusLabel = isPaid ? 'Pago' : isCancelled ? 'Cancelado' : isOverdue ? 'Vencido' : 'Pendente'

                return (
                  <div key={ar.id} className={cn(
                    'rounded-lg border p-4 space-y-3',
                    isPaid ? 'border-green-200 bg-green-50/30' : isOverdue ? 'border-red-200 bg-red-50/30' : 'border-gray-200'
                  )}>
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', statusBadgeClass)}>
                          {statusLabel}
                        </span>
                        <span className="text-sm font-medium text-gray-900">{ar.description}</span>
                      </div>
                      <Link href={`/financeiro/contas-receber/${ar.id}`}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                        Ver no financeiro <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>

                    {/* Payment info row */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Forma</p>
                        <p className="font-medium text-gray-700">{ar.payment_method || '--'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Total</p>
                        <p className="font-medium text-gray-900">{fmt(ar.total_amount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Recebido</p>
                        <p className="font-medium text-green-700">{fmt(ar.received_amount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Restante</p>
                        <p className={cn('font-medium', remaining > 0 ? 'text-red-600' : 'text-gray-500')}>
                          {fmt(remaining)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Vencimento</p>
                        <p className="font-medium text-gray-700">
                          {ar.due_date ? new Date(ar.due_date + 'T12:00:00').toLocaleDateString('pt-BR') : '--'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Pago em</p>
                        <p className={cn('font-medium', ar.status === 'RECEBIDO' ? 'text-green-700' : 'text-gray-400')}>
                          {ar.status === 'RECEBIDO' && ar.updated_at
                            ? new Date(ar.updated_at).toLocaleDateString('pt-BR')
                            : '--'}
                        </p>
                      </div>
                    </div>

                    {/* Card fee info */}
                    {ar.card_fee_total != null && ar.card_fee_total > 0 && (
                      <div className="flex flex-wrap gap-4 text-sm bg-amber-50 rounded-lg p-3 border border-amber-100">
                        <div>
                          <p className="text-xs text-gray-400 uppercase">Taxa operadora</p>
                          <p className="font-medium text-red-600">-{fmt(ar.card_fee_total)}</p>
                        </div>
                        {ar.net_amount != null && (
                          <div>
                            <p className="text-xs text-gray-400 uppercase">Valor liquido</p>
                            <p className="font-bold text-green-700">{fmt(ar.net_amount)}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Anticipation info */}
                    {ar.anticipated_at && (
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                          Antecipado
                        </span>
                        <span className="text-xs text-gray-500">
                          em {new Date(ar.anticipated_at).toLocaleDateString('pt-BR')}
                        </span>
                        {ar.anticipation_fee != null && (
                          <span className="text-xs text-red-600">
                            Taxa: -{fmt(ar.anticipation_fee)}
                          </span>
                        )}
                        {ar.anticipated_amount != null && (
                          <span className="text-xs font-medium text-green-700">
                            Recebido: {fmt(ar.anticipated_amount)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Installments table */}
                    {ar.installments && ar.installments.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs font-medium uppercase text-gray-400">
                              <th className="pb-1.5 w-10">#</th>
                              <th className="pb-1.5">Vencimento</th>
                              <th className="pb-1.5 text-right">Valor</th>
                              <th className="pb-1.5 text-center">Status</th>
                              <th className="pb-1.5 text-right">Pago em</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {ar.installments.map(inst => {
                              const instOverdue = inst.status === 'PENDENTE' && new Date(inst.due_date) < new Date()
                              const instPaid = inst.status === 'RECEBIDO'
                              const rowClass = instPaid
                                ? 'bg-green-50/50 text-green-800'
                                : instOverdue
                                  ? 'bg-red-50/50 text-red-800'
                                  : ''
                              return (
                                <tr key={inst.id} className={rowClass}>
                                  <td className="py-1.5 text-gray-500">{inst.installment_number}</td>
                                  <td className="py-1.5">{new Date(inst.due_date).toLocaleDateString('pt-BR')}</td>
                                  <td className="py-1.5 text-right font-medium">{fmt(inst.amount)}</td>
                                  <td className="py-1.5 text-center">
                                    <span className={cn(
                                      'text-xs font-semibold px-1.5 py-0.5 rounded-full',
                                      instPaid ? 'bg-green-100 text-green-700' : instOverdue ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                                    )}>
                                      {instPaid ? 'Pago' : instOverdue ? 'Vencido' : 'Pendente'}
                                    </span>
                                  </td>
                                  <td className="py-1.5 text-right text-gray-500">
                                    {inst.paid_at ? new Date(inst.paid_at).toLocaleDateString('pt-BR') : '--'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ========== DETAILS + HISTORY (side by side) ========== */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Details */}
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-gray-100">
              <FileText className="h-4 w-4 text-gray-600" />
            </div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Detalhes</h2>
          </div>
          <div className="space-y-2.5">
            <DetailRow label="Prioridade">
              <span className={cn('font-medium', priorityColor[os.priority] || 'text-gray-700')}>
                {priorityLabel[os.priority] ?? os.priority}
              </span>
            </DetailRow>
            <DetailRow label="Tipo">
              <span className="text-sm text-gray-900">{os.os_type}</span>
            </DetailRow>
            <DetailRow label="Tecnico">
              <span className="text-sm text-gray-900">{os.user_profiles?.name || '--'}</span>
            </DetailRow>
            <DetailRow label="Previsao">
              <span className="text-sm text-gray-900">{os.estimated_delivery ? new Date(os.estimated_delivery).toLocaleDateString('pt-BR') : '--'}</span>
            </DetailRow>
            <DetailRow label="Criada em">
              <span className="text-sm text-gray-900">{new Date(os.created_at).toLocaleDateString('pt-BR')}</span>
            </DetailRow>
            {(() => {
              // Data de conclusão = quando transitou para status "Pronta" (do histórico)
              const prontaEntry = os.service_order_history?.find(h => {
                const st = statusList.find(s => s.id === h.to_status_id)
                return st?.name?.toLowerCase().includes('pronta')
              })
              if (!prontaEntry) return null
              return (
                <DetailRow label="Concluida em">
                  <span className="text-sm text-blue-700 font-medium">{new Date(prontaEntry.created_at).toLocaleDateString('pt-BR')}</span>
                </DetailRow>
              )
            })()}
            {os.actual_delivery && (
              <DetailRow label="Entregue em">
                <span className="text-sm text-green-700 font-medium">{new Date(os.actual_delivery).toLocaleDateString('pt-BR')}</span>
              </DetailRow>
            )}
            {os.warranty_until && (
              <DetailRow label="Garantia ate">
                <span className="text-sm text-gray-900">{new Date(os.warranty_until).toLocaleDateString('pt-BR')}</span>
              </DetailRow>
            )}
          </div>
        </div>

        {/* History */}
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-green-100">
              <Clock className="h-4 w-4 text-green-600" />
            </div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Historico</h2>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {(os.service_order_history ?? []).length === 0 ? (
              <p className="text-gray-400 text-center py-4 text-sm">Nenhum registro</p>
            ) : os.service_order_history.map(h => {
              const fromName = h.from_status_id ? statusMap[h.from_status_id]?.name : null
              const toName = h.to_status_id ? statusMap[h.to_status_id]?.name : null
              const toColor = h.to_status_id ? statusMap[h.to_status_id]?.color : '#6B7280'
              const action = fromName && toName ? `${fromName} \u2192 ${toName}` : toName ? `Criada como ${toName}` : h.notes || 'Alteracao'
              return (
                <div key={h.id} className="flex items-start gap-2.5 text-sm py-1">
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: toColor }} />
                  <div className="min-w-0">
                    <p className="text-gray-700 text-sm">{action}</p>
                    {h.notes && <p className="text-xs text-gray-500">{h.notes}</p>}
                    <p className="text-xs text-gray-400">
                      {new Date(h.created_at).toLocaleString('pt-BR')}
                      {h.changed_by_name && <span className="ml-1">— por <span className="font-medium text-gray-500">{h.changed_by_name}</span></span>}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ========== FOTOS (collapsed if none) ========== */}
      {(os.service_order_photos ?? []).length > 0 && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-pink-100">
              <Camera className="h-4 w-4 text-pink-600" />
            </div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Fotos ({os.service_order_photos.length})</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {os.service_order_photos.map(f => (
              <div key={f.id} className="overflow-hidden rounded-lg border">
                <img src={f.photo_url} alt={f.description || ''} className="aspect-square w-full object-cover" />
                <p className="p-1.5 text-xs text-gray-500 truncate">{f.description || new Date(f.created_at).toLocaleDateString('pt-BR')}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========== PAYMENT MODAL ========== */}
      {showPaymentModal && os && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8" onClick={() => { setShowPaymentModal(false); setPendingStatusId(null) }}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl my-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-green-600" />
                Finalizar OS-{String(os.os_number).padStart(4, '0')}
              </h2>
              <button type="button" onClick={() => { setShowPaymentModal(false); setPendingStatusId(null) }} title="Fechar" className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center">
                <p className="text-sm text-green-600 font-medium">Total da OS</p>
                <p className="text-2xl font-bold text-green-800">{fmt(os.total_cost)}</p>
              </div>

              <p className="text-sm text-gray-600">
                Ao confirmar, uma <strong>conta a receber</strong> sera gerada automaticamente no financeiro.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Forma de pagamento *</label>
                {paymentMethods.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {paymentMethods.map(pm => (
                      <button key={pm.id} type="button" onClick={() => setPaymentMethod(pm.name)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                          paymentMethod === pm.name
                            ? 'border-green-500 bg-green-50 text-green-700'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}>
                        <span>{pm.icon}</span> {pm.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 text-sm text-gray-500">
                    <p>Nenhuma forma de pagamento cadastrada</p>
                    <a href="/financeiro/formas-pagamento" target="_blank" className="text-blue-600 hover:underline text-xs mt-1 inline-block">
                      Cadastrar formas de pagamento
                    </a>
                  </div>
                )}
              </div>

              {/* Installment selector for card payments */}
              {isCardPayment && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Parcelas</label>
                    <select
                      value={installmentCount}
                      onChange={e => setInstallmentCount(Number(e.target.value))}
                      title="Parcelas"
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:border-green-500 focus:ring-1 focus:ring-green-200"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>
                          {n}x de {fmt(Math.round(os.total_cost / n))}
                        </option>
                      ))}
                    </select>
                  </div>

                  {(() => {
                    const feePct = getCardFeePct()
                    if (feePct <= 0) return null
                    const feeAmount = Math.round(os.total_cost * (feePct / 100))
                    const netAmount = os.total_cost - feeAmount
                    return (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Valor total:</span>
                          <span className="font-medium text-gray-900">{fmt(os.total_cost)}</span>
                        </div>
                        {installmentCount > 1 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">{installmentCount}x de</span>
                            <span className="font-medium text-gray-900">{fmt(Math.round(os.total_cost / installmentCount))}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-red-600">
                          <span>Taxa operadora ({feePct}%):</span>
                          <span className="font-medium">-{fmt(feeAmount)}</span>
                        </div>
                        <div className="flex justify-between border-t border-amber-200 pt-1">
                          <span className="font-medium text-gray-700">Valor liquido:</span>
                          <span className="font-bold text-green-700">{fmt(netAmount)}</span>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observacoes</label>
                <input type="text" value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)}
                  placeholder="Numero do cartao, parcelas, etc..."
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => { setShowPaymentModal(false); setPendingStatusId(null) }}
                className="px-4 py-2.5 text-sm border rounded-lg hover:bg-gray-50 flex-1">Cancelar</button>
              <button type="button" onClick={handleConfirmDelivery} disabled={transitioning || !paymentMethod}
                className="px-4 py-2.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex-1 font-medium flex items-center justify-center gap-2">
                {transitioning && <Loader2 className="h-4 w-4 animate-spin" />}
                {transitioning ? 'Finalizando...' : 'Confirmar Entrega'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== PRINT / EMAIL MODAL ========== */}
      {/* ========== QUOTE EMAIL MODAL ========== */}
      {showQuoteModal && os && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowQuoteModal(false)}>
          <div className="w-full max-w-3xl max-h-[90vh] rounded-xl bg-white shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b shrink-0">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Send className="h-5 w-5 text-blue-600" />
                Enviar Orcamento - OS-{String(os.os_number).padStart(4, '0')}
              </h2>
              <button type="button" onClick={() => setShowQuoteModal(false)} title="Fechar" className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 border-b shrink-0">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Mail className="h-3.5 w-3.5 inline mr-1" /> Para:
              </label>
              <input type="email" value={quoteEmail} onChange={e => setQuoteEmail(e.target.value)}
                placeholder="email@exemplo.com"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
            </div>

            <div className="flex-1 overflow-auto p-4 bg-gray-50">
              {loadingQuotePreview ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  <span className="ml-2 text-sm text-gray-500">Carregando preview...</span>
                </div>
              ) : quotePreviewHtml ? (
                <iframe
                  srcDoc={quotePreviewHtml}
                  className="w-full border rounded-lg bg-white"
                  style={{ minHeight: '600px' }}
                  title="Preview do orcamento"
                />
              ) : (
                <p className="text-center text-gray-500 py-10">Erro ao carregar preview</p>
              )}
            </div>

            <div className="flex gap-2 p-4 border-t shrink-0">
              <button type="button" onClick={handleSendQuote} disabled={sendingQuote || !quoteEmail}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {sendingQuote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sendingQuote ? 'Enviando...' : 'Enviar Orcamento'}
              </button>
              <button type="button" onClick={() => setShowQuoteModal(false)}
                className="px-4 py-2.5 border rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrintModal && os && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPrintModal(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Printer className="h-5 w-5 text-green-600" />
                Imprimir OS-{String(os.os_number).padStart(4, '0')}
              </h2>
              <button type="button" onClick={() => setShowPrintModal(false)} title="Fechar" className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Deseja imprimir e/ou enviar por email?
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Mail className="h-3.5 w-3.5 inline mr-1" /> Email do cliente
              </label>
              <input type="email" value={printEmail} onChange={e => setPrintEmail(e.target.value)}
                placeholder="email@exemplo.com"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
            </div>

            <div className="space-y-2">
              <button type="button" onClick={handlePrintOnly}
                className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                <Printer className="h-4 w-4" /> Apenas Imprimir
              </button>

              <button type="button" onClick={handlePrintAndEmail} disabled={sendingEmail || !printEmail}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {sendingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Printer className="h-4 w-4" /><Send className="h-4 w-4" /></>}
                {sendingEmail ? 'Enviando...' : 'Imprimir e Enviar Email'}
              </button>

              <button type="button" onClick={handleEmailOnly} disabled={sendingEmail || !printEmail}
                className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-blue-200 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 transition-colors">
                {sendingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sendingEmail ? 'Enviando...' : 'Apenas Enviar Email'}
              </button>
            </div>

            <button type="button" onClick={() => setShowPrintModal(false)}
              className="w-full mt-3 px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ========== NFSE MODAL ========== */}
      {showNfseModal && os && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !emittingNfse && setShowNfseModal(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Receipt className="h-5 w-5 text-purple-600" />
                Emitir NFS-e - OS-{String(os.os_number).padStart(4, '0')}
              </h2>
              <button type="button" title="Fechar" onClick={() => setShowNfseModal(false)} disabled={emittingNfse} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Cliente:</span><span className="font-medium">{os.customers?.legal_name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">CPF/CNPJ:</span><span className="font-medium">{os.customers?.document_number || 'Nao informado'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Valor:</span><span className="font-bold text-green-700">R$ {(os.total_cost / 100).toFixed(2)}</span></div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Discriminacao do Servico</label>
                <textarea
                  value={nfseDescription}
                  onChange={e => setNfseDescription(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                  placeholder="Descricao detalhada do servico prestado..."
                />
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <strong>Atencion:</strong> A NFS-e sera emitida diretamente na Prefeitura de SP. Esta acao nao pode ser desfeita facilmente.
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button type="button" onClick={handleEmitirNfse} disabled={emittingNfse || !nfseDescription || os.total_cost <= 0}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 transition-colors">
                {emittingNfse ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
                {emittingNfse ? 'Emitindo...' : 'Emitir NFS-e'}
              </button>
              <button type="button" onClick={() => setShowNfseModal(false)} disabled={emittingNfse}
                className="px-4 py-2.5 border rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ========== INLINE ADD ITEM FORM COMPONENT ========== */

interface InlineAddItemFormProps {
  itemType: 'PECA' | 'SERVICO'
  setItemType: (t: 'PECA' | 'SERVICO') => void
  itemSearch: string
  setItemSearch: (s: string) => void
  itemResults: Produto[]
  setItemResults: (r: Produto[]) => void
  selectProduct: (p: Produto) => void
  showQuickRegister: boolean
  setShowQuickRegister: (v: boolean) => void
  quickName: string
  setQuickName: (v: string) => void
  quickPrice: string
  setQuickPrice: (v: string) => void
  quickSaving: boolean
  handleQuickRegister: () => void
  itemDesc: string
  setItemDesc: (v: string) => void
  itemQty: string
  setItemQty: (v: string) => void
  itemPrice: string
  setItemPrice: (v: string) => void
  setItemProductId: (v: string | null) => void
  addingItem: boolean
  handleAddItem: (closeAfter?: boolean) => void
  onCancel: () => void
  sectionType: 'SERVICO' | 'PECA'
  itemsAddedCount: number
  showAddedCheck: boolean
}

function InlineAddItemForm({
  itemType, setItemType,
  itemSearch, setItemSearch,
  itemResults, setItemResults,
  selectProduct,
  showQuickRegister, setShowQuickRegister,
  quickName, setQuickName,
  quickPrice, setQuickPrice,
  quickSaving, handleQuickRegister,
  itemDesc, setItemDesc,
  itemQty, setItemQty,
  itemPrice, setItemPrice,
  setItemProductId,
  addingItem, handleAddItem,
  onCancel,
  sectionType,
  itemsAddedCount,
  showAddedCheck,
}: InlineAddItemFormProps) {
  const isServico = sectionType === 'SERVICO'
  const borderColor = isServico ? 'border-amber-200' : 'border-blue-200'
  const bgColor = isServico ? 'bg-amber-50/50' : 'bg-blue-50/50'
  const btnColor = isServico ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'

  return (
    <div className={`rounded-lg border-2 ${borderColor} ${bgColor} p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-900 text-sm">
            {isServico ? 'Adicionar Servico' : 'Adicionar Produto'}
          </h3>
          {showAddedCheck && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded-full animate-pulse">
              <Check className="h-3 w-3" /> Adicionado!
            </span>
          )}
          {itemsAddedCount > 0 && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {itemsAddedCount} {itemsAddedCount === 1 ? 'item adicionado' : 'itens adicionados'}
            </span>
          )}
        </div>
        <button type="button" onClick={onCancel} title="Cancelar" className="text-gray-400 hover:text-gray-600 text-sm">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Product/service search */}
      <div className="relative">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Buscar {isServico ? 'servico' : 'produto'} cadastrado
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input type="text" value={itemSearch} onChange={e => setItemSearch(e.target.value)}
            placeholder={`Buscar ${isServico ? 'servico' : 'produto'}...`}
            className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white" />
        </div>
        {itemSearch.length >= 2 && (
          <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {itemResults.length > 0 ? itemResults.map(p => (
              <button key={p.id} type="button" onClick={() => selectProduct(p)}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm flex items-center justify-between">
                <span>
                  {p.unit === 'SV' ? <Wrench className="h-3 w-3 inline mr-1 text-amber-500" /> : <Package className="h-3 w-3 inline mr-1 text-blue-500" />}
                  {p.name} {p.brand && <span className="text-gray-400">({p.brand})</span>}
                </span>
                <span className="text-gray-500 font-medium">{fmt(p.sale_price)}</span>
              </button>
            )) : (
              <div className="px-3 py-2 text-sm text-gray-500">Nenhum resultado</div>
            )}
            <div className="border-t">
              <button type="button" onClick={() => { setShowQuickRegister(true); setQuickName(itemSearch); setItemSearch(''); setItemResults([]) }}
                className="w-full text-left px-3 py-2 hover:bg-green-50 text-sm font-medium text-green-700 flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Cadastrar &quot;{itemSearch}&quot; como {isServico ? 'servico' : 'produto'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick register inline form */}
      {showQuickRegister && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-green-800">
              Cadastrar {isServico ? 'Servico' : 'Produto'}
            </h4>
            <button type="button" onClick={() => setShowQuickRegister(false)} className="text-green-600 hover:text-green-800 text-xs">Cancelar</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <input type="text" value={quickName} onChange={e => setQuickName(e.target.value)}
                placeholder="Nome" className="w-full px-3 py-2 border rounded-lg text-sm bg-white" />
            </div>
            <div>
              <input type="number" step="0.01" min="0" value={quickPrice} onChange={e => setQuickPrice(e.target.value)}
                placeholder="Preco R$" className="w-full px-3 py-2 border rounded-lg text-sm bg-white" />
            </div>
          </div>
          <button type="button" onClick={handleQuickRegister} disabled={quickSaving}
            className="w-full py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-1.5">
            {quickSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {quickSaving ? 'Cadastrando...' : 'Cadastrar e Selecionar'}
          </button>
        </div>
      )}

      {/* Description / Qty / Price */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Descricao *</label>
        <input type="text" value={itemDesc} onChange={e => { setItemDesc(e.target.value); setItemProductId(null) }}
          placeholder={isServico ? 'Ex: Limpeza de cabecote' : 'Ex: Toner HP 85A'}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Qtd</label>
          <input type="number" min="1" value={itemQty} onChange={e => setItemQty(e.target.value)}
            placeholder="1" className="w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">V.Unit (R$)</label>
          <input type="number" step="0.01" min="0" value={itemPrice} onChange={e => setItemPrice(e.target.value)}
            placeholder="0,00"
            className="w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Total</label>
          <div className="px-3 py-2 bg-white border rounded-lg text-sm font-semibold text-gray-900">
            {fmt(Math.round((parseInt(itemQty) || 1) * parseFloat(itemPrice || '0') * 100))}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => handleAddItem(false)} disabled={addingItem}
          className={`flex-1 py-2.5 ${btnColor} text-white rounded-lg disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-2 transition-colors`}>
          {addingItem && <Loader2 className="h-4 w-4 animate-spin" />}
          {addingItem ? 'Adicionando...' : 'Adicionar e Continuar'}
        </button>
        <button type="button" onClick={() => handleAddItem(true)} disabled={addingItem}
          className="px-4 py-2.5 border-2 border-gray-300 text-gray-700 rounded-lg disabled:opacity-50 text-sm font-medium hover:bg-gray-50 transition-colors whitespace-nowrap">
          Adicionar e Fechar
        </button>
      </div>
    </div>
  )
}

/* ========== HELPER COMPONENTS ========== */

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-gray-400 uppercase font-medium">{label}</span>
      {children}
    </div>
  )
}
