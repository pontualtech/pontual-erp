'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ArrowLeft, Edit, Camera, History, Info, Package, Plus, Trash2, Loader2, Search, Wrench, CreditCard, X } from 'lucide-react'

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
  changed_by: string | null; notes: string | null; created_at: string
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
  created_at: string; updated_at: string; customers: Customer | null
  service_order_items: OSItem[]; service_order_photos: OSPhoto[]
  service_order_history: OSHistoryEntry[]
}
interface Produto { id: string; name: string; unit: string; sale_price: number; brand: string | null }

const tabs = [
  { key: 'info', label: 'Informações', icon: Info },
  { key: 'itens', label: 'Itens / Orçamento', icon: Package },
  { key: 'fotos', label: 'Fotos', icon: Camera },
  { key: 'historico', label: 'Histórico', icon: History },
] as const
type Tab = typeof tabs[number]['key']

const priorityLabel: Record<string, string> = { LOW: 'Baixa', MEDIUM: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' }

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function OSDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [os, setOs] = useState<OSDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('info')
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

  // Payment modal (for delivery/final status)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string; icon: string; active: boolean }[]>([])
  const [paymentMethodsLoaded, setPaymentMethodsLoaded] = useState(false)

  function loadOS() {
    fetch(`/api/os/${id}`)
      .then(r => r.json())
      .then(d => setOs(d.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

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

  async function handleAddItem() {
    if (!itemDesc.trim()) { toast.error('Descrição é obrigatória'); return }
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

      toast.success('Item adicionado!')
      setItemDesc(''); setItemQty('1'); setItemPrice(''); setItemProductId(null)
      setShowAddItem(false)
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
    if (!quickName.trim()) { toast.error('Nome é obrigatório'); return }
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
      toast.success(`${itemType === 'SERVICO' ? 'Serviço' : 'Produto'} cadastrado e selecionado!`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setQuickSaving(false)
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
    // Check if next status has name containing "Entreg" (Entregue) and OS has value
    const isDelivery = next.name.toLowerCase().includes('entreg') && !next.name.toLowerCase().includes('recusado')
    if (isDelivery && os.total_cost > 0) {
      setPaymentMethod('')
      setPaymentNotes('')
      // Load payment methods if not loaded yet
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

  async function doTransition(toStatusId: string, payment_method?: string, notes?: string) {
    setTransitioning(true)
    try {
      const body: any = { toStatusId }
      if (payment_method) body.payment_method = payment_method
      if (notes) body.notes = notes
      const res = await fetch(`/api/os/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro na transição')
      if (data.data?.receivable_created) {
        toast.success('OS finalizada! Conta a receber gerada automaticamente.')
      }
      setShowPaymentModal(false)
      loadOS()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally { setTransitioning(false) }
  }

  async function handleConfirmDelivery() {
    if (!paymentMethod) { toast.error('Selecione a forma de pagamento'); return }
    const next = getNextStatus()
    if (!next) return
    doTransition(next.id, paymentMethod, paymentNotes || undefined)
  }

  if (loading) return <p className="p-6 text-gray-400">Carregando...</p>
  if (!os) return <p className="p-6 text-red-500">OS não encontrada</p>

  const currentStatus = statusMap[os.status_id]
  const nextStatus = getNextStatus()
  const items = os.service_order_items ?? []
  const pecas = items.filter(i => i.item_type === 'PECA')
  const servicos = items.filter(i => i.item_type !== 'PECA')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/os" className="rounded-md p-1.5 hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">OS-{String(os.os_number).padStart(4, '0')}</h1>
          {currentStatus && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: currentStatus.color }}>
              {currentStatus.name}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {nextStatus && (
            <button type="button" onClick={handleAdvanceClick} disabled={transitioning}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {transitioning ? '...' : `Avançar → ${nextStatus.name}`}
            </button>
          )}
          <Link href={`/os/${id}/editar`} className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50">
            <Edit className="h-4 w-4" /> Editar
          </Link>
        </div>
      </div>

      {/* Budget summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-white p-4 text-center">
          <p className="text-xs text-gray-500 uppercase font-medium">Peças</p>
          <p className="text-lg font-bold text-gray-900">{fmt(os.total_parts)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4 text-center">
          <p className="text-xs text-gray-500 uppercase font-medium">Serviços</p>
          <p className="text-lg font-bold text-gray-900">{fmt(os.total_services)}</p>
        </div>
        <div className="rounded-lg border bg-blue-50 border-blue-200 p-4 text-center">
          <p className="text-xs text-blue-600 uppercase font-medium">Total</p>
          <p className="text-lg font-bold text-blue-700">{fmt(os.total_cost)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              )}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        {tab === 'info' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cliente" value={os.customers?.legal_name ?? '—'} />
            <Field label="Telefone" value={os.customers?.mobile || os.customers?.phone || '—'} />
            <Field label="Email" value={os.customers?.email || '—'} />
            <Field label="Tipo" value={os.os_type} />
            <Field label="Equipamento" value={os.equipment_type || '—'} />
            <Field label="Marca / Modelo" value={`${os.equipment_brand || ''} ${os.equipment_model || ''}`.trim() || '—'} />
            <Field label="Nº Série" value={os.serial_number || '—'} />
            <Field label="Prioridade" value={priorityLabel[os.priority] ?? os.priority} />
            <Field label="Data Abertura" value={new Date(os.created_at).toLocaleDateString('pt-BR')} />
            <Field label="Previsão Entrega" value={os.estimated_delivery ? new Date(os.estimated_delivery).toLocaleDateString('pt-BR') : '—'} />
            <div className="sm:col-span-2"><Field label="Defeito Relatado" value={os.reported_issue || '—'} /></div>
            <div className="sm:col-span-2"><Field label="Diagnóstico" value={os.diagnosis || '—'} /></div>
            {os.internal_notes && <div className="sm:col-span-2"><Field label="Notas Internas" value={os.internal_notes} /></div>}
          </div>
        )}

        {tab === 'itens' && (
          <div className="space-y-4">
            {/* Add item button */}
            <div className="flex justify-end">
              <button type="button" onClick={() => setShowAddItem(true)}
                className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                <Plus className="h-4 w-4" /> Adicionar Item
              </button>
            </div>

            {/* Add item form */}
            {showAddItem && (
              <div className="rounded-lg border-2 border-blue-200 bg-blue-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Novo Item</h3>
                  <button type="button" onClick={() => setShowAddItem(false)} className="text-gray-400 hover:text-gray-600 text-sm">Cancelar</button>
                </div>

                {/* Type selector */}
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setItemType('SERVICO'); setItemSearch(''); setItemResults([]) }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium border transition-colors ${
                      itemType === 'SERVICO' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}><Wrench className="h-4 w-4" /> Serviço</button>
                  <button type="button" onClick={() => { setItemType('PECA'); setItemSearch(''); setItemResults([]) }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium border transition-colors ${
                      itemType === 'PECA' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}><Package className="h-4 w-4" /> Peça</button>
                </div>

                {/* Product/service search */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Buscar {itemType === 'PECA' ? 'produto' : 'serviço'} cadastrado
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                    <input type="text" value={itemSearch} onChange={e => setItemSearch(e.target.value)}
                      placeholder={`Buscar ${itemType === 'PECA' ? 'produto' : 'serviço'}...`}
                      className="w-full pl-9 pr-3 py-2 border rounded-md text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
                  </div>
                  {itemSearch.length >= 2 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
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
                          <Plus className="h-3.5 w-3.5" /> Cadastrar "{itemSearch}" como {itemType === 'SERVICO' ? 'serviço' : 'produto'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick register inline form */}
                {showQuickRegister && (
                  <div className="rounded-md border border-green-200 bg-green-50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-green-800">
                        Cadastrar {itemType === 'SERVICO' ? 'Serviço' : 'Produto'}
                      </h4>
                      <button type="button" onClick={() => setShowQuickRegister(false)} className="text-green-600 hover:text-green-800 text-xs">Cancelar</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <input type="text" value={quickName} onChange={e => setQuickName(e.target.value)}
                          placeholder="Nome" className="w-full px-3 py-2 border rounded-md text-sm" />
                      </div>
                      <div>
                        <input type="number" step="0.01" min="0" value={quickPrice} onChange={e => setQuickPrice(e.target.value)}
                          placeholder="Preço R$" className="w-full px-3 py-2 border rounded-md text-sm" />
                      </div>
                    </div>
                    <button type="button" onClick={handleQuickRegister} disabled={quickSaving}
                      className="w-full py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-1.5">
                      {quickSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      {quickSaving ? 'Cadastrando...' : 'Cadastrar e Selecionar'}
                    </button>
                  </div>
                )}

                {/* Manual entry */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Descrição *</label>
                  <input type="text" value={itemDesc} onChange={e => { setItemDesc(e.target.value); setItemProductId(null) }}
                    placeholder={itemType === 'PECA' ? 'Ex: Toner HP 85A' : 'Ex: Limpeza de cabeçote'}
                    className="w-full px-3 py-2 border rounded-md text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Qtd</label>
                    <input type="number" min="1" value={itemQty} onChange={e => setItemQty(e.target.value)}
                      placeholder="1" className="w-full px-3 py-2 border rounded-md text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Valor Unit. (R$)</label>
                    <input type="number" step="0.01" min="0" value={itemPrice} onChange={e => setItemPrice(e.target.value)}
                      placeholder="0,00"
                      className="w-full px-3 py-2 border rounded-md text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Total</label>
                    <div className="px-3 py-2 bg-gray-50 border rounded-md text-sm font-semibold text-gray-900">
                      {fmt(Math.round((parseInt(itemQty) || 1) * parseFloat(itemPrice || '0') * 100))}
                    </div>
                  </div>
                </div>

                <button type="button" onClick={handleAddItem} disabled={addingItem}
                  className="w-full py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-2">
                  {addingItem && <Loader2 className="h-4 w-4 animate-spin" />}
                  {addingItem ? 'Adicionando...' : 'Adicionar ao Orçamento'}
                </button>
              </div>
            )}

            {/* Items list */}
            {items.length === 0 && !showAddItem ? (
              <div className="text-center py-8 text-gray-400">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>Nenhum item adicionado</p>
                <p className="text-sm mt-1">Clique em "Adicionar Item" para compor o orçamento</p>
              </div>
            ) : (
              <>
                {/* Peças */}
                {pecas.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1.5">
                      <Package className="h-4 w-4 text-blue-500" /> Peças ({pecas.length})
                    </h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs font-medium uppercase text-gray-400">
                          <th className="pb-2">Descrição</th>
                          <th className="pb-2 w-16 text-right">Qtd</th>
                          <th className="pb-2 w-24 text-right">Unit.</th>
                          <th className="pb-2 w-24 text-right">Total</th>
                          <th className="pb-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {pecas.map(item => (
                          <tr key={item.id} className="group">
                            <td className="py-2">{item.description || '—'}</td>
                            <td className="py-2 text-right">{item.quantity}</td>
                            <td className="py-2 text-right text-gray-500">{fmt(item.unit_price)}</td>
                            <td className="py-2 text-right font-medium">{fmt(item.total_price)}</td>
                            <td className="py-2 text-right">
                              <button type="button" onClick={() => handleDeleteItem(item.id)} title="Remover"
                                disabled={deletingItem === item.id}
                                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50">
                                {deletingItem === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t font-medium">
                          <td colSpan={3} className="py-2 text-right text-gray-500">Subtotal Peças:</td>
                          <td className="py-2 text-right">{fmt(os.total_parts)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Serviços */}
                {servicos.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1.5">
                      <Wrench className="h-4 w-4 text-amber-500" /> Serviços ({servicos.length})
                    </h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs font-medium uppercase text-gray-400">
                          <th className="pb-2">Descrição</th>
                          <th className="pb-2 w-16 text-right">Qtd</th>
                          <th className="pb-2 w-24 text-right">Unit.</th>
                          <th className="pb-2 w-24 text-right">Total</th>
                          <th className="pb-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {servicos.map(item => (
                          <tr key={item.id} className="group">
                            <td className="py-2">{item.description || '—'}</td>
                            <td className="py-2 text-right">{item.quantity}</td>
                            <td className="py-2 text-right text-gray-500">{fmt(item.unit_price)}</td>
                            <td className="py-2 text-right font-medium">{fmt(item.total_price)}</td>
                            <td className="py-2 text-right">
                              <button type="button" onClick={() => handleDeleteItem(item.id)} title="Remover"
                                disabled={deletingItem === item.id}
                                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50">
                                {deletingItem === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t font-medium">
                          <td colSpan={3} className="py-2 text-right text-gray-500">Subtotal Serviços:</td>
                          <td className="py-2 text-right">{fmt(os.total_services)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Grand total */}
                {items.length > 0 && (
                  <div className="border-t-2 pt-3 flex justify-between items-center">
                    <span className="text-sm font-semibold text-gray-700 uppercase">Total do Orçamento</span>
                    <span className="text-xl font-bold text-blue-700">{fmt(os.total_cost)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'fotos' && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {(os.service_order_photos ?? []).length === 0 ? (
              <p className="col-span-full text-gray-400 text-center py-8">Nenhuma foto</p>
            ) : os.service_order_photos.map(f => (
              <div key={f.id} className="overflow-hidden rounded-lg border">
                <img src={f.photo_url} alt={f.description || ''} className="aspect-square w-full object-cover" />
                <p className="p-2 text-xs text-gray-500">{f.description || new Date(f.created_at).toLocaleDateString('pt-BR')}</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'historico' && (
          <ul className="space-y-3">
            {(os.service_order_history ?? []).length === 0 ? (
              <li className="text-gray-400 text-center py-8">Nenhum registro</li>
            ) : os.service_order_history.map(h => {
              const fromName = h.from_status_id ? statusMap[h.from_status_id]?.name : null
              const toName = h.to_status_id ? statusMap[h.to_status_id]?.name : null
              const toColor = h.to_status_id ? statusMap[h.to_status_id]?.color : '#6B7280'
              const action = fromName && toName ? `${fromName} → ${toName}` : toName ? `Criada como ${toName}` : h.notes || 'Alteração'
              return (
                <li key={h.id} className="flex items-start gap-3 text-sm">
                  <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: toColor }} />
                  <div>
                    <p className="text-gray-700">{action}</p>
                    {h.notes && <p className="text-xs text-gray-500">{h.notes}</p>}
                    <p className="text-xs text-gray-400">{new Date(h.created_at).toLocaleString('pt-BR')}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Payment modal for delivery */}
      {showPaymentModal && os && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPaymentModal(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-green-600" />
                Finalizar OS-{String(os.os_number).padStart(4, '0')}
              </h2>
              <button type="button" onClick={() => setShowPaymentModal(false)} title="Fechar" className="p-1 rounded hover:bg-gray-100 text-gray-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Total */}
              <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center">
                <p className="text-sm text-green-600 font-medium">Total da OS</p>
                <p className="text-2xl font-bold text-green-800">{fmt(os.total_cost)}</p>
              </div>

              <p className="text-sm text-gray-600">
                Ao confirmar, uma <strong>conta a receber</strong> será gerada automaticamente no financeiro.
              </p>

              {/* Payment method */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Forma de pagamento *</label>
                {paymentMethods.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {paymentMethods.map(pm => (
                      <button key={pm.id} type="button" onClick={() => setPaymentMethod(pm.name)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium border-2 transition-colors ${
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
                      Cadastrar formas de pagamento →
                    </a>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
                <input type="text" value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)}
                  placeholder="Número do cartão, parcelas, etc..."
                  className="w-full px-3 py-2 border rounded-md text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setShowPaymentModal(false)}
                className="px-4 py-2.5 text-sm border rounded-md hover:bg-gray-50 flex-1">Cancelar</button>
              <button type="button" onClick={handleConfirmDelivery} disabled={transitioning || !paymentMethod}
                className="px-4 py-2.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex-1 font-medium flex items-center justify-center gap-2">
                {transitioning && <Loader2 className="h-4 w-4 animate-spin" />}
                {transitioning ? 'Finalizando...' : 'Confirmar Entrega'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm text-gray-900">{value}</p>
    </div>
  )
}
