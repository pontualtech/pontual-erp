'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ArrowLeft, Plus, Trash2, Loader2, Edit, X, Save, DollarSign, Clock, Upload, Search } from 'lucide-react'
import { MoneyInput } from '@/app/(dashboard)/components/money-input'

interface PriceEntry {
  id: string
  equipment_type: string | null
  brand: string | null
  model_pattern: string | null
  service_description: string | null
  default_price: number
  estimated_time_minutes: number | null
  is_active: boolean
  created_at: string
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function TabelaPrecosPage() {
  const [entries, setEntries] = useState<PriceEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const limit = 25

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formEquipType, setFormEquipType] = useState('')
  const [formBrand, setFormBrand] = useState('')
  const [formModel, setFormModel] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPrice, setFormPrice] = useState('')
  const [formTime, setFormTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // CSV import
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  function loadEntries() {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (search) params.set('search', search)
    fetch(`/api/price-table?${params}`)
      .then(r => r.json())
      .then(d => {
        setEntries(d.data ?? [])
        setTotal(d.total ?? 0)
      })
      .catch(() => toast.error('Erro ao carregar tabela de precos'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadEntries() }, [page, search])

  function openCreate() {
    setEditingId(null)
    setFormEquipType('')
    setFormBrand('')
    setFormModel('')
    setFormDescription('')
    setFormPrice('')
    setFormTime('')
    setShowForm(true)
  }

  function openEdit(entry: PriceEntry) {
    setEditingId(entry.id)
    setFormEquipType(entry.equipment_type || '')
    setFormBrand(entry.brand || '')
    setFormModel(entry.model_pattern || '')
    setFormDescription(entry.service_description || '')
    setFormPrice(String((entry.default_price || 0) / 100))
    setFormTime(entry.estimated_time_minutes ? String(entry.estimated_time_minutes) : '')
    setShowForm(true)
  }

  async function handleSave() {
    if (!formDescription.trim()) { toast.error('Descricao do servico e obrigatoria'); return }
    setSaving(true)
    try {
      const payload = {
        equipment_type: formEquipType.trim() || null,
        brand: formBrand.trim() || null,
        model_pattern: formModel.trim() || null,
        service_description: formDescription.trim(),
        default_price: Math.round(parseFloat(formPrice || '0') * 100),
        estimated_time_minutes: formTime ? parseInt(formTime) : null,
      }

      const url = editingId ? `/api/price-table/${editingId}` : '/api/price-table'
      const method = editingId ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar')
      toast.success(editingId ? 'Entrada atualizada!' : 'Entrada criada!')
      setShowForm(false)
      loadEntries()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover esta entrada?')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/price-table/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Entrada removida')
      loadEntries()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleImportCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length < 2) { toast.error('CSV vazio ou sem dados'); return }

      // Expected: equipamento,marca,modelo,servico,preco,tempo_min
      const header = lines[0].toLowerCase()
      const hasHeader = header.includes('equipamento') || header.includes('servico') || header.includes('descri')
      const dataLines = hasHeader ? lines.slice(1) : lines

      let created = 0
      for (const line of dataLines) {
        const cols = line.split(/[;,]/).map(c => c.trim().replace(/^["']|["']$/g, ''))
        if (cols.length < 4) continue

        const payload = {
          equipment_type: cols[0] || null,
          brand: cols[1] || null,
          model_pattern: cols[2] || null,
          service_description: cols[3] || null,
          default_price: Math.round(parseFloat((cols[4] || '0').replace(',', '.')) * 100),
          estimated_time_minutes: cols[5] ? parseInt(cols[5]) : null,
        }

        const res = await fetch('/api/price-table', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) created++
      }

      toast.success(`${created} ${created === 1 ? 'entrada importada' : 'entradas importadas'} com sucesso!`)
      loadEntries()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar CSV')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-lg border p-2 hover:bg-gray-50">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Tabela de Precos</h1>
            <p className="text-sm text-gray-500">Precos padrao por equipamento/servico para orcamentos inteligentes</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className={cn(
            'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer transition-colors',
            importing ? 'opacity-50' : 'hover:bg-gray-50'
          )}>
            <Upload className="h-4 w-4" />
            {importing ? 'Importando...' : 'Importar CSV'}
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImportCSV} disabled={importing} />
          </label>
          <button type="button" onClick={openCreate}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Plus className="h-4 w-4" /> Nova Entrada
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Buscar por equipamento, marca, modelo ou servico..."
          className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">Nenhuma entrada na tabela de precos</p>
            <p className="text-sm mt-1">Cadastre precos padrao para agilizar orcamentos.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                    <th className="px-4 py-3">Equipamento</th>
                    <th className="px-4 py-3">Marca</th>
                    <th className="px-4 py-3">Modelo (padrao)</th>
                    <th className="px-4 py-3">Servico</th>
                    <th className="px-4 py-3 text-right">Preco</th>
                    <th className="px-4 py-3 text-right">Tempo Est.</th>
                    <th className="px-4 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entries.map(entry => (
                    <tr key={entry.id} className="group hover:bg-blue-50/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{entry.equipment_type || '--'}</td>
                      <td className="px-4 py-3 text-gray-700">{entry.brand || '--'}</td>
                      <td className="px-4 py-3 text-gray-700 font-mono text-xs">{entry.model_pattern || '--'}</td>
                      <td className="px-4 py-3 text-gray-900">{entry.service_description || '--'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-green-700">{fmt(entry.default_price)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {entry.estimated_time_minutes ? `${entry.estimated_time_minutes} min` : '--'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button" onClick={() => openEdit(entry)} title="Editar"
                            className="p-1.5 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600">
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => handleDelete(entry.id)} title="Remover"
                            disabled={deletingId === entry.id}
                            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50">
                            {deletingId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-gray-500">{total} {total === 1 ? 'entrada' : 'entradas'}</p>
                <div className="flex gap-1">
                  <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-50">Anterior</button>
                  <span className="px-3 py-1 text-xs text-gray-500">{page} / {totalPages}</span>
                  <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-50">Proxima</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* CSV format hint */}
      <div className="rounded-lg border bg-gray-50 p-4 text-xs text-gray-500">
        <p className="font-medium text-gray-700 mb-1">Formato CSV para importacao:</p>
        <p className="font-mono">equipamento;marca;modelo;servico;preco;tempo_min</p>
        <p className="font-mono mt-0.5">Impressora;HP;LaserJet Pro;Limpeza completa;150.00;60</p>
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !saving && setShowForm(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-green-600" />
                {editingId ? 'Editar Entrada' : 'Nova Entrada'}
              </h2>
              <button type="button" onClick={() => setShowForm(false)} disabled={saving}
                title="Fechar" className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Equipamento</label>
                  <input type="text" value={formEquipType} onChange={e => setFormEquipType(e.target.value)}
                    placeholder="Ex: Impressora" className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Marca</label>
                  <input type="text" value={formBrand} onChange={e => setFormBrand(e.target.value)}
                    placeholder="Ex: HP" className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Modelo (padrao)</label>
                  <input type="text" value={formModel} onChange={e => setFormModel(e.target.value)}
                    placeholder="Ex: LaserJet" className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descricao do Servico *</label>
                <input type="text" value={formDescription} onChange={e => setFormDescription(e.target.value)}
                  placeholder="Ex: Limpeza completa com troca de rolo"
                  className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Preco Padrao (R$)</label>
                  <MoneyInput value={parseFloat(formPrice) || 0}
                    onChange={v => setFormPrice(String(v))} placeholder="0,00" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tempo Estimado (min)</label>
                  <input type="number" min="0" value={formTime} onChange={e => setFormTime(e.target.value)}
                    placeholder="Ex: 60" className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowForm(false)} disabled={saving}
                className="flex-1 px-4 py-2.5 text-sm border rounded-lg hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="flex-1 px-4 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
