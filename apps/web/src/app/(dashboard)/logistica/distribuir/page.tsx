'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Loader2, Users, MapPin, Wand2, ClipboardPaste, Filter, X, Check, Package, Truck, ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'

type User = { id: string; name: string }
type StatusItem = { id: string; name: string; description?: string }
type BulkItem = {
  os_id: string; os_number: number; status: string
  suggested_type: 'COLETA' | 'ENTREGA'
  customer_name: string; customer_phone: string; address: string; equipment: string
  lat: number | null; lng: number | null
  selected: boolean
}
type Assignment = {
  driver_id: string
  driver_name: string
  items: Omit<BulkItem, 'selected'>[]
}

function todayISO() { return new Date().toISOString().slice(0, 10) }

/**
 * /logistica/distribuir
 *
 * Fluxo multi-motorista:
 *   1. Escolhe 2+ motoristas (checkbox)
 *   2. Abre modal "Importar OS" (status ou colar numeros)
 *   3. Clica Distribuir -> chama /api/logistics/distribute (k-means)
 *   4. Ve preview com abas por motorista — cada OS com chip da cor
 *      do motorista + possibilidade de desmarcar
 *   5. Clica Redistribuir pra rerun com pool atualizado
 *   6. Clica Criar N Rotas -> /api/logistics/routes/bulk-create
 */
export default function DistribuirRotasPage() {
  const router = useRouter()
  const [drivers, setDrivers] = useState<User[]>([])
  const [selectedDriverIds, setSelectedDriverIds] = useState<string[]>([])
  const [date, setDate] = useState(todayISO())
  const [loadingDrivers, setLoadingDrivers] = useState(true)

  // Pool: OS encontradas pela importacao (toda a base antes de dividir)
  const [pool, setPool] = useState<BulkItem[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [distributing, setDistributing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [balanced, setBalanced] = useState(true)

  // Bulk import modal
  const [showModal, setShowModal] = useState(false)
  const [bulkTab, setBulkTab] = useState<'status' | 'paste'>('status')
  const [statusOptions, setStatusOptions] = useState<StatusItem[]>([])
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['Coletar', 'Entregar Reparado'])
  const [pasteText, setPasteText] = useState('')
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    fetch('/api/users')
      .then(r => r.json())
      .then(d => setDrivers(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar motoristas'))
      .finally(() => setLoadingDrivers(false))

    // Carrega status (usa padroes se falhar)
    fetch('/api/module-statuses?module=os')
      .then(r => r.json())
      .then(d => {
        const items = (d.data ?? []).filter((s: any) =>
          /colet|entreg/i.test(s.name || '')
        )
        if (items.length > 0) setStatusOptions(items)
        else setStatusOptions([
          { id: 'coletar', name: 'Coletar', description: 'OS aguardando coleta' },
          { id: 'entregar-reparado', name: 'Entregar Reparado', description: 'OS pronta pra entrega' },
          { id: 'entregar-recusado', name: 'Entregar Recusado', description: 'OS devolvida sem servico' },
        ])
      })
      .catch(() => {})
  }, [])

  function extractNumbers(text: string): number[] {
    const matches = text.match(/\b\d{3,7}\b/g) || []
    const seen = new Set<number>()
    return matches.map(m => Number(m)).filter(n => Number.isFinite(n) && n > 0 && !seen.has(n) && seen.add(n))
  }

  const toggleDriver = (id: string) => {
    setSelectedDriverIds(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id])
    // Qualquer mudanca de motoristas invalida a distribuicao anterior
    setAssignments([])
  }

  async function fetchPoolOnly() {
    const numbers = bulkTab === 'paste' ? extractNumbers(pasteText) : []
    const statuses = bulkTab === 'status' ? selectedStatuses : []
    if (numbers.length === 0 && statuses.length === 0) {
      toast.error('Informe status ou numeros')
      return
    }
    setFetching(true)
    try {
      const res = await fetch('/api/logistics/lookup-os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numbers, statuses, order: 'nearest' }),
      })
      if (!res.ok) { toast.error('Erro ao buscar OS'); return }
      const { data } = await res.json()
      const items: BulkItem[] = (data.items || []).map((it: any) => ({ ...it, selected: true }))
      setPool(items)
      setAssignments([])
      setShowModal(false)
      toast.success(`${items.length} OS carregadas. Clique em "Distribuir" pra dividir entre motoristas.`)
    } catch { toast.error('Falha de rede') }
    finally { setFetching(false) }
  }

  async function distribute() {
    if (selectedDriverIds.length < 2) {
      toast.error('Selecione ao menos 2 motoristas')
      return
    }
    const selectedPool = pool.filter(p => p.selected)
    if (selectedPool.length < selectedDriverIds.length) {
      toast.error(`Menos OS (${selectedPool.length}) que motoristas (${selectedDriverIds.length})`)
      return
    }
    setDistributing(true)
    try {
      // Manda apenas os numeros das OS selecionadas pra garantir consistencia
      const res = await fetch('/api/logistics/distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_ids: selectedDriverIds,
          numbers: selectedPool.map(p => p.os_number),
        }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Erro' }))
        toast.error(error || 'Falha ao distribuir'); return
      }
      const { data } = await res.json()
      setAssignments(data.assignments || [])
      setBalanced(data.balanced)
      toast.success(`Distribuidas em ${data.assignments.length} motoristas em ${data.iterations} iteracoes`)
    } catch { toast.error('Falha de rede') }
    finally { setDistributing(false) }
  }

  function toggleOsInPool(osId: string) {
    setPool(prev => prev.map(p => p.os_id === osId ? { ...p, selected: !p.selected } : p))
    setAssignments([]) // invalida distribuicao
  }

  async function createAll() {
    if (assignments.length === 0) return
    const totalStops = assignments.reduce((s, a) => s + a.items.length, 0)
    if (totalStops === 0) { toast.error('Nenhuma parada atribuida'); return }
    if (!confirm(`Criar ${assignments.filter(a => a.items.length > 0).length} rotas com ${totalStops} paradas no total?`)) return

    setCreating(true)
    try {
      const body = {
        date,
        assignments: assignments.map(a => ({
          driver_id: a.driver_id,
          stops: a.items.map((it, idx) => ({
            os_id: it.os_id,
            type: it.suggested_type,
            sequence: idx + 1,
            customer_name: it.customer_name,
            customer_phone: it.customer_phone,
            address: it.address,
            lat: it.lat,
            lng: it.lng,
          })),
        })),
      }
      const res = await fetch('/api/logistics/routes/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Erro' }))
        toast.error(error || 'Falha ao criar rotas'); return
      }
      const { data } = await res.json()
      toast.success(`${data.total_routes} rotas criadas!`)
      router.push('/logistica')
    } catch { toast.error('Falha de rede') }
    finally { setCreating(false) }
  }

  // Paleta de cores pra motoristas — circula se mais que a paleta
  const DRIVER_COLORS = [
    { bg: 'bg-blue-100', border: 'border-blue-400', text: 'text-blue-700', chip: 'bg-blue-500' },
    { bg: 'bg-emerald-100', border: 'border-emerald-400', text: 'text-emerald-700', chip: 'bg-emerald-500' },
    { bg: 'bg-purple-100', border: 'border-purple-400', text: 'text-purple-700', chip: 'bg-purple-500' },
    { bg: 'bg-amber-100', border: 'border-amber-400', text: 'text-amber-700', chip: 'bg-amber-500' },
    { bg: 'bg-rose-100', border: 'border-rose-400', text: 'text-rose-700', chip: 'bg-rose-500' },
  ]

  const selectedCount = pool.filter(p => p.selected).length
  const totalAssigned = assignments.reduce((s, a) => s + a.items.length, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/logistica" className="rounded-lg border p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Distribuir em Rotas</h1>
      </div>

      {/* Config inicial */}
      <div className="rounded-xl border bg-white p-5 shadow-sm space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Data</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
              <Users className="h-4 w-4" /> Motoristas ({selectedDriverIds.length} selecionados)
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto border rounded-lg p-2">
              {loadingDrivers ? (
                <span className="text-xs text-gray-400">Carregando…</span>
              ) : drivers.map((d, idx) => {
                const selected = selectedDriverIds.includes(d.id)
                const color = selected ? DRIVER_COLORS[selectedDriverIds.indexOf(d.id) % DRIVER_COLORS.length] : null
                return (
                  <button type="button" key={d.id} onClick={() => toggleDriver(d.id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${selected
                      ? `${color!.bg} ${color!.border} ${color!.text}`
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {selected ? '✓ ' : ''}{d.name}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Clique pra alternar. Minimo 2 pra distribuir.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <button type="button" onClick={() => setShowModal(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Filter className="h-4 w-4" />
            Importar OS
          </button>
          {pool.length > 0 && (
            <button type="button" onClick={distribute}
              disabled={distributing || selectedDriverIds.length < 2 || selectedCount < selectedDriverIds.length}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50">
              {distributing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {assignments.length > 0 ? 'Redistribuir' : 'Distribuir automaticamente'}
            </button>
          )}
          <div className="ml-auto text-sm text-gray-500">
            {pool.length > 0 && <span>{selectedCount}/{pool.length} OS selecionadas</span>}
          </div>
        </div>
      </div>

      {/* Pool de OS quando ainda nao distribuiu */}
      {pool.length > 0 && assignments.length === 0 && (
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">
            Pool de OS ({selectedCount} selecionadas) — desmarque as que nao quer distribuir
          </h2>
          <div className="grid gap-2 md:grid-cols-2">
            {pool.map(item => (
              <label key={item.os_id}
                className={`flex items-start gap-2 p-2 rounded-lg border text-xs cursor-pointer ${item.selected ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                <input type="checkbox" checked={item.selected} onChange={() => toggleOsInPool(item.os_id)} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${item.suggested_type === 'COLETA' ? 'bg-purple-200 text-purple-800' : 'bg-emerald-200 text-emerald-800'}`}>
                      {item.suggested_type}
                    </span>
                    <span className="font-mono text-gray-500">#{item.os_number}</span>
                    <span className="font-semibold truncate">{item.customer_name}</span>
                  </div>
                  <p className="text-gray-500 truncate mt-0.5">{item.address}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Preview da distribuicao */}
      {assignments.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-gray-900">
              Distribuicao {balanced ? '✓ balanceada' : '⚠ desbalanceada'} — {totalAssigned} paradas
            </h2>
            <div className="flex gap-2">
              <button type="button" onClick={distribute} disabled={distributing}
                className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">
                <Wand2 className="h-3.5 w-3.5" /> Redistribuir
              </button>
              <button type="button" onClick={createAll} disabled={creating || totalAssigned === 0}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Criar {assignments.filter(a => a.items.length > 0).length} Rotas
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {assignments.map((a, idx) => {
              const color = DRIVER_COLORS[idx % DRIVER_COLORS.length]
              return (
                <div key={a.driver_id} className={`rounded-xl border-2 ${color.border} bg-white overflow-hidden`}>
                  <div className={`${color.bg} ${color.text} px-4 py-2.5 flex items-center justify-between border-b ${color.border}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${color.chip}`} />
                      <span className="font-bold text-sm">{a.driver_name}</span>
                    </div>
                    <span className="text-xs font-semibold">{a.items.length} paradas</span>
                  </div>
                  <ol className="divide-y divide-gray-100">
                    {a.items.map((item, i) => (
                      <li key={item.os_id} className="px-3 py-2 text-xs flex items-start gap-2">
                        <span className="text-gray-400 font-mono shrink-0 w-5">{i + 1}.</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0 rounded ${item.suggested_type === 'COLETA' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {item.suggested_type}
                            </span>
                            <span className="font-mono text-gray-400">#{item.os_number}</span>
                          </div>
                          <p className="font-semibold text-gray-900 truncate">{item.customer_name}</p>
                          <p className="text-gray-500 truncate">{item.address}</p>
                        </div>
                      </li>
                    ))}
                    {a.items.length === 0 && (
                      <li className="px-3 py-8 text-center text-xs text-gray-400">
                        Sem paradas atribuidas
                      </li>
                    )}
                  </ol>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal Importar OS */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Importar OS pro pool</h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex gap-2 border-b mb-4">
              <button type="button" onClick={() => setBulkTab('status')}
                className={`px-3 py-2 text-sm font-medium border-b-2 ${bulkTab === 'status' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>
                <Filter className="h-3.5 w-3.5 inline mr-1" /> Por status
              </button>
              <button type="button" onClick={() => setBulkTab('paste')}
                className={`px-3 py-2 text-sm font-medium border-b-2 ${bulkTab === 'paste' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>
                <ClipboardPaste className="h-3.5 w-3.5 inline mr-1" /> Colar numeros
              </button>
            </div>

            {bulkTab === 'status' && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 mb-2">Busca todas as OS nos status selecionados.</p>
                {statusOptions.map(s => {
                  const checked = selectedStatuses.some(ss => s.name.toLowerCase().includes(ss.toLowerCase()))
                  return (
                    <label key={s.id} className="flex items-start gap-2 p-2 rounded-lg border hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={checked}
                        onChange={() => setSelectedStatuses(prev => checked ? prev.filter(n => !s.name.toLowerCase().includes(n.toLowerCase())) : [...prev, s.name])}
                        className="mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">{s.name}</p>
                        {s.description && <p className="text-xs text-gray-500">{s.description}</p>}
                      </div>
                    </label>
                  )
                })}
              </div>
            )}

            {bulkTab === 'paste' && (
              <div>
                <p className="text-xs text-gray-500 mb-2">Cole qualquer texto — o sistema extrai os numeros de OS.</p>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
                  placeholder="Ex: 60095, 60146, 60147..."
                  rows={5}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none" />
                <p className="text-xs text-gray-400 mt-1">{extractNumbers(pasteText).length} numeros detectados</p>
              </div>
            )}

            <button type="button" onClick={fetchPoolOnly} disabled={fetching}
              className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {fetching ? 'Buscando…' : 'Carregar OS'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
