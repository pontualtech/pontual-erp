'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Search, Package, Truck, Loader2, User, MapPin, Phone, ClipboardList, Plus, X } from 'lucide-react'
import CepAddressForm, { buildFullAddress, EMPTY_ADDRESS, type AddressParts } from '../_components/CepAddressForm'

type LookupItem = {
  os_id: string
  os_number: number
  status: string
  equipment: string
  customer: {
    id: string
    name: string
    doc: string | null
    phone: string | null
    address: string
    lat: number | null
    lng: number | null
  } | null
}

type Mode = 'number' | 'doc'

export default function AvulsoPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('number')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<LookupItem[]>([])
  const [searched, setSearched] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)

  // Parada sem OS (AVULSA) — ex: fornecedor, mecanico, banco
  const [freeOpen, setFreeOpen] = useState(false)
  const [freeTitle, setFreeTitle] = useState('')
  const [freeAddr, setFreeAddr] = useState<AddressParts>(EMPTY_ADDRESS)
  const [freeNotes, setFreeNotes] = useState('')
  const [freeSaving, setFreeSaving] = useState(false)

  async function createFreeStop() {
    const t = freeTitle.trim()
    if (!t) return toast.error('De um titulo (ex: Buscar peca no fornecedor)')
    if (!freeAddr.street.trim() || !freeAddr.number.trim()) {
      return toast.error('Preencha rua e numero')
    }
    const address = buildFullAddress(freeAddr)
    setFreeSaving(true)
    try {
      const res = await fetch('/api/driver/stop/avulsa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t, address, notes: freeNotes.trim() || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j?.error || 'Falha ao criar parada'); return }
      toast.success(j.data?.geocoded ? 'Parada adicionada a rota' : 'Parada adicionada (sem coordenadas)')
      router.push('/motorista/rota')
    } catch {
      toast.error('Falha de rede')
    } finally {
      setFreeSaving(false)
    }
  }

  async function search() {
    const trimmed = input.trim()
    if (!trimmed) return toast.error('Informe OS ou CPF/CNPJ')
    setLoading(true)
    setSearched(false)
    setItems([])
    try {
      const qs = mode === 'number' ? `number=${encodeURIComponent(trimmed)}` : `doc=${encodeURIComponent(trimmed)}`
      const res = await fetch(`/api/driver/os/lookup?${qs}`, { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast.error(j?.error || 'Falha na busca')
        return
      }
      const j = await res.json()
      setItems(j.data.items || [])
      setSearched(true)
      if ((j.data.items || []).length === 0) {
        toast.info(mode === 'number' ? 'OS nao encontrada (ou nao e EXTERNA)' : 'CPF/CNPJ sem OS externa ativa')
      }
    } catch {
      toast.error('Falha de rede')
    } finally {
      setLoading(false)
    }
  }

  async function create(osId: string, type: 'COLETA' | 'ENTREGA') {
    setCreating(`${osId}-${type}`)
    try {
      const res = await fetch('/api/driver/stop/adhoc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ os_id: osId, type }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j?.error || 'Falha ao criar')
        return
      }
      toast.success('Parada avulsa criada')
      router.push(j.data.redirect)
    } catch {
      toast.error('Falha de rede')
    } finally {
      setCreating(null)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="sticky top-0 bg-blue-700 text-white px-4 py-3 flex items-center gap-3 shadow z-10">
        <Link href="/motorista/rota" className="p-1.5 hover:bg-white/10 rounded-full" aria-label="Voltar">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="font-bold text-lg leading-tight">Adicionar Parada</h1>
          <p className="text-xs opacity-80">OS, cliente ou parada livre</p>
        </div>
      </header>

      <main className="p-4 space-y-4 pb-24">
        {/* Parada sem OS — fornecedor, mecanico, banco, etc */}
        <section className="bg-white rounded-xl border p-3 space-y-3">
          {!freeOpen ? (
            <button type="button" onClick={() => setFreeOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 text-amber-800 font-semibold text-sm active:scale-[0.98]">
              <Plus className="w-4 h-4" />
              Parada sem OS (fornecedor, mecanico...)
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
                  <ClipboardList className="w-4 h-4" />
                  Parada sem OS
                </div>
                <button type="button" onClick={() => setFreeOpen(false)} aria-label="Fechar"
                  className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">O que vai fazer?</label>
                <input type="text" value={freeTitle} onChange={e => setFreeTitle(e.target.value)}
                  placeholder="Ex: Buscar peca no fornecedor Fulano"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" />
              </div>
              <CepAddressForm value={freeAddr} onChange={setFreeAddr} />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Observacao <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <textarea value={freeNotes} onChange={e => setFreeNotes(e.target.value)} rows={2}
                  placeholder="Ex: perguntar pelo Marcio, pagar R$ 40"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
              </div>
              <button type="button" onClick={createFreeStop} disabled={freeSaving}
                className="w-full py-3 bg-amber-600 text-white rounded-lg font-semibold text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
                {freeSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Adicionar a rota
              </button>
            </div>
          )}
        </section>

        {/* Modo de busca */}
        <section className="bg-white rounded-xl border p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('number')}
              className={`py-2 rounded-lg border-2 font-medium text-sm transition ${
                mode === 'number' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700'
              }`}>
              Numero da OS
            </button>
            <button type="button" onClick={() => setMode('doc')}
              className={`py-2 rounded-lg border-2 font-medium text-sm transition ${
                mode === 'doc' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700'
              }`}>
              CPF / CNPJ
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') search() }}
              inputMode={mode === 'number' ? 'numeric' : 'tel'}
              placeholder={mode === 'number' ? 'Ex: 60123' : 'Digite CPF ou CNPJ (so numeros)'}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm"
            />
            <button type="button" onClick={search} disabled={loading || !input.trim()}
              className="bg-blue-600 text-white px-4 py-2.5 rounded-lg font-medium disabled:opacity-50 active:scale-95">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            </button>
          </div>
        </section>

        {/* Resultados */}
        {searched && items.length === 0 && (
          <div className="text-center py-8 text-sm text-gray-500">
            Nenhuma OS encontrada.
          </div>
        )}

        {items.map(item => (
          <div key={item.os_id} className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                OS #{item.os_number}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">{item.status || '—'}</span>
            </div>
            {item.customer && (
              <div className="space-y-1">
                <div className="flex items-start gap-2">
                  <User className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{item.customer.name}</p>
                    {item.customer.doc && <p className="text-[11px] text-gray-500">{item.customer.doc}</p>}
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <span className="text-xs text-gray-700 leading-snug">{item.customer.address}</span>
                </div>
                {item.customer.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-xs text-gray-700">{item.customer.phone}</span>
                  </div>
                )}
              </div>
            )}
            {item.equipment && (
              <p className="text-xs text-gray-500">📦 {item.equipment}</p>
            )}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button type="button" disabled={creating !== null}
                onClick={() => create(item.os_id, 'COLETA')}
                className="py-2.5 bg-purple-600 text-white rounded-lg font-semibold text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1.5">
                {creating === `${item.os_id}-COLETA` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                Coleta
              </button>
              <button type="button" disabled={creating !== null}
                onClick={() => create(item.os_id, 'ENTREGA')}
                className="py-2.5 bg-emerald-600 text-white rounded-lg font-semibold text-sm active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1.5">
                {creating === `${item.os_id}-ENTREGA` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                Entrega
              </button>
            </div>
          </div>
        ))}
      </main>
    </div>
  )
}
