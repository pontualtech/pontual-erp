'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Loader2,
  X, Search, MapPin, Clock, Package, Truck as TruckIcon, GripVertical,
  ClipboardPaste, Filter, Check,
} from 'lucide-react'
import { toast } from 'sonner'

/* ---------- Interfaces ---------- */

interface User {
  id: string
  name: string
}

interface OSResult {
  id: string
  os_number: number
  customer_name: string
  customer_address: string | null
  equipment_type: string | null
}

interface Stop {
  tempId: string
  type: 'COLETA' | 'ENTREGA'
  os_id: string | null
  os_number: number | null
  customer_name: string
  address: string
  time_window_start: string
  time_window_end: string
}

/* ---------- Helpers ---------- */

function generateTempId() {
  return Math.random().toString(36).slice(2, 10)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

/* ---------- Component ---------- */

export default function NovaRotaPage() {
  const router = useRouter()

  const [drivers, setDrivers] = useState<User[]>([])
  const [driverId, setDriverId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [stops, setStops] = useState<Stop[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [loadingDrivers, setLoadingDrivers] = useState(true)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [stopType, setStopType] = useState<'COLETA' | 'ENTREGA'>('COLETA')
  const [osSearch, setOsSearch] = useState('')
  const [osResults, setOsResults] = useState<OSResult[]>([])
  const [searchingOs, setSearchingOs] = useState(false)
  const [selectedOs, setSelectedOs] = useState<OSResult | null>(null)
  const [manualAddress, setManualAddress] = useState('')
  const [manualCustomer, setManualCustomer] = useState('')
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')

  // Bulk import modal state
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkTab, setBulkTab] = useState<'status' | 'paste'>('status')
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['Coletar'])
  const [pasteText, setPasteText] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [orderByProximity, setOrderByProximity] = useState(true)  // default ON — faz roteiro melhor
  type BulkItem = {
    os_id: string; os_number: number; status: string
    suggested_type: 'COLETA' | 'ENTREGA'
    customer_name: string; customer_phone: string; address: string; equipment: string
    selected: boolean
  }
  const [bulkResults, setBulkResults] = useState<BulkItem[]>([])
  const [bulkMissing, setBulkMissing] = useState<number[]>([])

  // Load drivers
  useEffect(() => {
    fetch('/api/users')
      .then(r => r.json())
      .then(d => setDrivers(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar motoristas'))
      .finally(() => setLoadingDrivers(false))
  }, [])

  // OS search debounce
  const searchOS = useCallback(async (term: string) => {
    if (term.length < 2) {
      setOsResults([])
      return
    }
    setSearchingOs(true)
    try {
      const res = await fetch(`/api/os?search=${encodeURIComponent(term)}&limit=10`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setOsResults(
        (data.data ?? []).map((os: any) => {
          const c = os.customers
          // Monta endereco completo: rua, numero, complemento, bairro, cidade/UF, CEP
          const full = c ? [
            c.address_street,
            c.address_number ? `n° ${c.address_number}` : null,
            c.address_complement,
            c.address_neighborhood,
            c.address_city && c.address_state ? `${c.address_city}/${c.address_state}` : c.address_city,
            c.address_zip,
          ].filter(Boolean).join(', ') : (os.address ?? null)
          return {
            id: os.id,
            os_number: os.os_number,
            customer_name: c?.trade_name || c?.legal_name || 'Sem cliente',
            customer_address: full || null,
            equipment_type: os.equipment_type,
          }
        })
      )
    } catch {
      setOsResults([])
    } finally {
      setSearchingOs(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => searchOS(osSearch), 300)
    return () => clearTimeout(timer)
  }, [osSearch, searchOS])

  const resetModal = () => {
    setStopType('COLETA')
    setOsSearch('')
    setOsResults([])
    setSelectedOs(null)
    setManualAddress('')
    setManualCustomer('')
    setTimeStart('')
    setTimeEnd('')
  }

  const openModal = () => {
    resetModal()
    setShowModal(true)
  }

  /** Extrai sequencias numericas de texto livre (colar OS). Aceita separadores
   *  variados: vírgula, espaço, quebra de linha, ponto-e-vírgula, tab. */
  function extractNumbers(text: string): number[] {
    const matches = text.match(/\b\d{3,7}\b/g) || []
    const nums = matches.map(m => parseInt(m, 10)).filter(n => Number.isFinite(n) && n > 0)
    return Array.from(new Set(nums))  // dedup
  }

  /** Busca bulk no backend e popula bulkResults pra preview. */
  async function fetchBulk() {
    setBulkLoading(true)
    setBulkResults([])
    setBulkMissing([])
    try {
      const body: Record<string, unknown> = {}
      if (bulkTab === 'paste') {
        const nums = extractNumbers(pasteText)
        if (nums.length === 0) { toast.error('Nenhum numero de OS encontrado'); return }
        body.numbers = nums
      } else {
        if (selectedStatuses.length === 0) { toast.error('Selecione ao menos um status'); return }
        body.statuses = selectedStatuses
      }
      if (orderByProximity) body.order = 'nearest'
      const res = await fetch('/api/logistics/lookup-os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data?.error || 'Erro ao buscar OS'); return }
      // Filtra OS ja adicionadas na rota pra nao duplicar
      const alreadyAddedIds = new Set(stops.filter(s => s.os_id).map(s => s.os_id))
      const items: BulkItem[] = (data.data.items || []).map((it: any) => ({
        ...it,
        selected: !alreadyAddedIds.has(it.os_id),
      }))
      setBulkResults(items)
      setBulkMissing(data.data.missing || [])
      if (items.length === 0) toast.info('Nenhuma OS encontrada')
    } catch { toast.error('Falha de rede') }
    finally { setBulkLoading(false) }
  }

  /** Adiciona as BulkItems selecionadas como stops na rota. */
  function applyBulk() {
    const toAdd = bulkResults.filter(b => b.selected)
    if (toAdd.length === 0) { toast.error('Selecione pelo menos uma OS'); return }
    const newStops: Stop[] = toAdd.map(b => ({
      tempId: generateTempId(),
      type: b.suggested_type,
      os_id: b.os_id,
      os_number: b.os_number,
      customer_name: b.customer_name || 'Cliente',
      address: b.address || '',
      time_window_start: '',
      time_window_end: '',
    }))
    setStops(prev => [...prev, ...newStops])
    toast.success(`${toAdd.length} parada(s) adicionada(s)`)
    setShowBulkModal(false)
    setPasteText('')
    setBulkResults([])
    setBulkMissing([])
  }

  const openBulkModal = () => {
    setBulkTab('status')
    setSelectedStatuses(['Coletar', 'Entregar Reparado'])
    setPasteText('')
    setBulkResults([])
    setBulkMissing([])
    setShowBulkModal(true)
  }

  const addStop = () => {
    const address = selectedOs?.customer_address || manualAddress
    const customerName = selectedOs?.customer_name || manualCustomer

    if (!address.trim()) {
      toast.error('Endereco e obrigatorio')
      return
    }
    if (!customerName.trim()) {
      toast.error('Nome do cliente e obrigatorio')
      return
    }

    const newStop: Stop = {
      tempId: generateTempId(),
      type: stopType,
      os_id: selectedOs?.id ?? null,
      os_number: selectedOs?.os_number ?? null,
      customer_name: customerName,
      address: address,
      time_window_start: timeStart,
      time_window_end: timeEnd,
    }
    setStops(prev => [...prev, newStop])
    setShowModal(false)
    resetModal()
  }

  const removeStop = (tempId: string) => {
    setStops(prev => prev.filter(s => s.tempId !== tempId))
  }

  const moveStop = (index: number, direction: 'up' | 'down') => {
    const newStops = [...stops]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newStops.length) return
    ;[newStops[index], newStops[targetIndex]] = [newStops[targetIndex], newStops[index]]
    setStops(newStops)
  }

  const handleSubmit = async () => {
    if (!driverId) {
      toast.error('Selecione um motorista')
      return
    }
    if (!date) {
      toast.error('Selecione uma data')
      return
    }
    if (stops.length === 0) {
      toast.error('Adicione pelo menos uma parada')
      return
    }

    setSubmitting(true)
    try {
      const body = {
        driver_id: driverId,
        date,
        stops: stops.map((s, i) => ({
          sequence: i + 1,
          type: s.type,
          os_id: s.os_id,
          customer_name: s.customer_name,
          address: s.address,
          time_window_start: s.time_window_start || null,
          time_window_end: s.time_window_end || null,
        })),
      }

      const res = await fetch('/api/logistics/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Erro ao criar rota')
      }

      toast.success('Rota criada com sucesso')
      router.push('/logistica')
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao criar rota')
    } finally {
      setSubmitting(false)
    }
  }

  // ESC to close modal
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) { if (e.key === 'Escape') setShowModal(false) }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [])

  const stopTypeConfig = {
    COLETA: { label: 'Coleta', bg: 'bg-orange-100', text: 'text-orange-700', icon: Package },
    ENTREGA: { label: 'Entrega', bg: 'bg-green-100', text: 'text-green-700', icon: TruckIcon },
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/logistica" className="rounded-lg border p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Nova Rota</h1>
      </div>

      {/* Form */}
      <div className="rounded-xl border bg-white p-6 shadow-sm space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* Driver */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Motorista</label>
            {loadingDrivers ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : (
              <select
                value={driverId}
                onChange={e => setDriverId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">Selecione o motorista</option>
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Data</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Stops */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-gray-700">
              Paradas ({stops.length})
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openBulkModal}
                className="flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                Importar em massa
              </button>
              <button
                type="button"
                onClick={openModal}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar Parada
              </button>
            </div>
          </div>

          {stops.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 p-8 text-center">
              <MapPin className="h-8 w-8 text-gray-200 mb-2" />
              <p className="text-sm text-gray-400">Nenhuma parada adicionada</p>
              <button
                type="button"
                onClick={openModal}
                className="mt-3 text-sm text-blue-600 hover:underline"
              >
                Adicionar primeira parada
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {stops.map((stop, index) => {
                const config = stopTypeConfig[stop.type]
                const StopIcon = config.icon
                return (
                  <div
                    key={stop.tempId}
                    className="flex items-center gap-3 rounded-lg border bg-gray-50 px-4 py-3"
                  >
                    {/* Sequence */}
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600">
                      {index + 1}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', config.bg, config.text)}>
                          <StopIcon className="h-3 w-3" />
                          {config.label}
                        </span>
                        {stop.os_number && (
                          <span className="text-xs text-gray-400">OS-{String(stop.os_number).padStart(4, '0')}</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm font-medium text-gray-900 truncate">{stop.customer_name}</p>
                      <p className="text-xs text-gray-400 truncate flex items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {stop.address}
                      </p>
                      {(stop.time_window_start || stop.time_window_end) && (
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3 shrink-0" />
                          {stop.time_window_start || '—'} — {stop.time_window_end || '—'}
                        </p>
                      )}
                    </div>

                    {/* Reorder + Remove */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        title="Mover para cima"
                        disabled={index === 0}
                        onClick={() => moveStop(index, 'up')}
                        className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Mover para baixo"
                        disabled={index === stops.length - 1}
                        onClick={() => moveStop(index, 'down')}
                        className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      title="Remover parada"
                      onClick={() => removeStop(stop.tempId)}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3 pt-2 border-t">
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar Rota
          </button>
          <Link
            href="/logistica"
            className="rounded-lg border px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </Link>
        </div>
      </div>

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowBulkModal(false)}>
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Importar paradas em massa</h3>
              <button type="button" aria-label="Fechar" onClick={() => setShowBulkModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b">
              <button
                type="button"
                onClick={() => { setBulkTab('status'); setBulkResults([]); setBulkMissing([]) }}
                className={cn('flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2',
                  bulkTab === 'status' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500 hover:text-gray-700')}
              >
                <Filter className="h-4 w-4" /> Por status
              </button>
              <button
                type="button"
                onClick={() => { setBulkTab('paste'); setBulkResults([]); setBulkMissing([]) }}
                className={cn('flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2',
                  bulkTab === 'paste' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500 hover:text-gray-700')}
              >
                <ClipboardPaste className="h-4 w-4" /> Colar numeros
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {bulkTab === 'status' ? (
                <div>
                  <p className="text-sm text-gray-600 mb-3">
                    Selecione os status. O sistema busca todas as OS nesses status e sugere o tipo de parada (COLETA/ENTREGA) automaticamente.
                  </p>
                  <div className="space-y-2">
                    {[
                      { name: 'Coletar', description: 'OS aguardando coleta no cliente' },
                      { name: 'Entregar Reparado', description: 'OS consertada, aguardando entrega' },
                      { name: 'Entregar Recusado', description: 'OS recusada, devolucao ao cliente' },
                    ].map(s => {
                      const checked = selectedStatuses.includes(s.name)
                      return (
                        <label key={s.name} className={cn('flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition',
                          checked ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300')}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => {
                              setSelectedStatuses(prev => e.target.checked ? [...prev, s.name] : prev.filter(x => x !== s.name))
                            }}
                            className="h-4 w-4"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">{s.name}</p>
                            <p className="text-xs text-gray-500">{s.description}</p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-600 mb-2">
                    Cole os numeros das OS (1 por linha, separados por virgula, espaco, etc):
                  </p>
                  <textarea
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    rows={5}
                    placeholder="6023, 6024&#10;6025 6026&#10;6027"
                    className="w-full rounded-lg border px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
                  />
                  {pasteText && (
                    <p className="text-xs text-gray-500 mt-1">
                      {extractNumbers(pasteText).length} numero(s) detectado(s)
                    </p>
                  )}
                </div>
              )}

              {/* Opcao de ordenacao — default ON porque 95% dos casos o operador
                  quer a rota agrupada por bairro. Desligavel pra manter ordem
                  crono/numerica original. */}
              <label className="flex items-start gap-2 p-3 rounded-lg bg-green-50 border border-green-200 cursor-pointer">
                <input type="checkbox" checked={orderByProximity}
                  onChange={e => setOrderByProximity(e.target.checked)}
                  className="h-4 w-4 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-900">📍 Ordenar por proximidade</p>
                  <p className="text-xs text-green-700 mt-0.5">
                    Agrupa paradas por cidade → bairro → CEP. Motorista pega tudo
                    de um bairro de uma vez, sem zigue-zague.
                  </p>
                </div>
              </label>

              <button
                type="button"
                onClick={fetchBulk}
                disabled={bulkLoading}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar OS
              </button>

              {/* Preview */}
              {bulkResults.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700">
                      {bulkResults.length} OS encontrada(s) &middot; {bulkResults.filter(b => b.selected).length} selecionada(s)
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setBulkResults(prev => prev.map(b => ({ ...b, selected: true })))}
                        className="text-xs text-blue-600 hover:underline">Marcar tudo</button>
                      <button type="button" onClick={() => setBulkResults(prev => prev.map(b => ({ ...b, selected: false })))}
                        className="text-xs text-gray-500 hover:underline">Desmarcar</button>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto border rounded-lg p-2">
                    {bulkResults.map((b, i) => {
                      const cfg = stopTypeConfig[b.suggested_type]
                      const StopIcon = cfg.icon
                      return (
                        <label key={b.os_id} className="flex items-start gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer">
                          <input type="checkbox" checked={b.selected}
                            onChange={e => setBulkResults(prev => prev.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                            className="h-4 w-4 mt-0.5" />
                          {orderByProximity && (
                            <div className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                              {i + 1}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', cfg.bg, cfg.text)}>
                                <StopIcon className="h-3 w-3" /> {cfg.label}
                              </span>
                              <span className="text-xs font-semibold text-gray-600">#{b.os_number}</span>
                              <span className="text-xs text-gray-400">{b.status}</span>
                            </div>
                            <p className="text-sm font-medium text-gray-900 truncate">{b.customer_name}</p>
                            {b.address && <p className="text-xs text-gray-500 truncate">{b.address}</p>}
                            {!b.address && <p className="text-xs text-red-500 italic">⚠ Cliente sem endereço cadastrado</p>}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {bulkMissing.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  <strong>Não encontradas:</strong> {bulkMissing.join(', ')}
                </div>
              )}
            </div>

            <div className="p-4 border-t flex items-center justify-end gap-2">
              <button type="button" onClick={() => setShowBulkModal(false)}
                className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button type="button" onClick={applyBulk}
                disabled={bulkResults.filter(b => b.selected).length === 0}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                <Check className="h-4 w-4" />
                Adicionar {bulkResults.filter(b => b.selected).length || ''} parada(s)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Stop Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900">Adicionar Parada</h3>
              <button type="button" title="Fechar" onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Tipo</label>
                <div className="flex gap-3">
                  {(['COLETA', 'ENTREGA'] as const).map(type => {
                    const cfg = stopTypeConfig[type]
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setStopType(type)}
                        className={cn(
                          'flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-colors',
                          stopType === type
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        )}
                      >
                        {cfg.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* OS Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Ordem de Servico (opcional)
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={osSearch}
                    onChange={e => { setOsSearch(e.target.value); setSelectedOs(null) }}
                    placeholder="Buscar por numero ou cliente..."
                    className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  {searchingOs && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />}
                </div>
                {/* Results dropdown */}
                {osResults.length > 0 && !selectedOs && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border bg-white shadow-lg">
                    {osResults.map(os => (
                      <button
                        key={os.id}
                        type="button"
                        onClick={() => {
                          setSelectedOs(os)
                          setOsSearch(`OS-${String(os.os_number).padStart(4, '0')} — ${os.customer_name}`)
                          setOsResults([])
                          if (os.customer_address) setManualAddress(os.customer_address)
                          setManualCustomer(os.customer_name)
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">OS-{String(os.os_number).padStart(4, '0')}</span>
                        <span className="truncate text-gray-500">{os.customer_name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedOs && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm">
                    <span className="font-medium text-blue-700">OS-{String(selectedOs.os_number).padStart(4, '0')}</span>
                    <span className="text-blue-600">{selectedOs.customer_name}</span>
                    <button
                      type="button"
                      onClick={() => { setSelectedOs(null); setOsSearch('') }}
                      className="ml-auto text-blue-400 hover:text-blue-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Customer name (if no OS) */}
              {!selectedOs && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome do Cliente</label>
                  <input
                    type="text"
                    value={manualCustomer}
                    onChange={e => setManualCustomer(e.target.value)}
                    placeholder="Nome do cliente"
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}

              {/* Address */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Endereco</label>
                <input
                  type="text"
                  value={selectedOs?.customer_address || manualAddress}
                  onChange={e => setManualAddress(e.target.value)}
                  readOnly={!!selectedOs?.customer_address}
                  placeholder="Rua, numero, bairro, cidade"
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none',
                    selectedOs?.customer_address && 'bg-gray-50 text-gray-500'
                  )}
                />
              </div>

              {/* Time window */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Horario Inicio</label>
                  <input
                    type="time"
                    value={timeStart}
                    onChange={e => setTimeStart(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Horario Fim</label>
                  <input
                    type="time"
                    value={timeEnd}
                    onChange={e => setTimeEnd(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={addStop}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  Adicionar
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
