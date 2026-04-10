'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Save, Monitor, Wrench, ClipboardList, Settings2 } from 'lucide-react'

export default function EditarOSPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [osNumber, setOsNumber] = useState(0)

  // Equipment data
  const [marcas, setMarcas] = useState<string[]>([])
  const [modelos, setModelos] = useState<string[]>([])
  const [equipTypes, setEquipTypes] = useState<string[]>([])
  const [showMarcaDropdown, setShowMarcaDropdown] = useState(false)
  const [showModeloDropdown, setShowModeloDropdown] = useState(false)
  const marcaRef = useRef<HTMLDivElement>(null)
  const modeloRef = useRef<HTMLDivElement>(null)

  const [form, setForm] = useState({
    equipment_type: '',
    equipment_brand: '',
    equipment_model: '',
    serial_number: '',
    reference: '',
    reported_issue: '',
    diagnosis: '',
    reception_notes: '',
    internal_notes: '',
    priority: 'MEDIUM',
    os_type: 'BALCAO',
    estimated_cost: 0,
    estimated_delivery: '',
  })

  // Load OS data
  useEffect(() => {
    fetch(`/api/os/${id}`)
      .then(r => r.json())
      .then(d => {
        const os = d.data
        if (!os) { toast.error('OS nao encontrada'); router.push('/os'); return }
        setOsNumber(os.os_number)
        setForm({
          equipment_type: os.equipment_type || '',
          equipment_brand: os.equipment_brand || '',
          equipment_model: os.equipment_model || '',
          serial_number: os.serial_number || '',
          reference: os.reference || '',
          reported_issue: os.reported_issue || '',
          diagnosis: os.diagnosis || '',
          reception_notes: os.reception_notes || '',
          internal_notes: os.internal_notes || '',
          priority: os.priority || 'MEDIUM',
          os_type: os.os_type || 'BALCAO',
          estimated_cost: os.estimated_cost || 0,
          estimated_delivery: os.estimated_delivery ? os.estimated_delivery.split('T')[0] : '',
        })
      })
      .catch(() => { toast.error('Erro ao carregar'); router.push('/os') })
      .finally(() => setLoading(false))
  }, [id, router])

  // Load brands + equipment types
  useEffect(() => {
    fetch('/api/equipamentos?type=marcas').then(r => r.json()).then(d => setMarcas(d.data ?? [])).catch(() => {})
    fetch('/api/settings/equipamentos-os').then(r => r.json()).then(d => setEquipTypes(d.data ?? [])).catch(() => {})
  }, [])

  // Load models when brand changes
  useEffect(() => {
    if (!form.equipment_brand) { setModelos([]); return }
    fetch(`/api/equipamentos?type=modelos&marca=${encodeURIComponent(form.equipment_brand)}`)
      .then(r => r.json()).then(d => setModelos(d.data ?? [])).catch(() => {})
  }, [form.equipment_brand])

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (marcaRef.current && !marcaRef.current.contains(e.target as Node)) setShowMarcaDropdown(false)
      if (modeloRef.current && !modeloRef.current.contains(e.target as Node)) setShowModeloDropdown(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function update(field: string, value: string | number) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        ...form,
        estimated_delivery: form.estimated_delivery || null,
        reference: form.reference || null,
      }
      const res = await fetch(`/api/os/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar')
      toast.success('OS atualizada!')
      router.push(`/os/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center py-20 gap-2 text-gray-400 dark:text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Carregando...</div>

  const inp = "w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors text-sm"

  const filteredMarcas = marcas.filter(m => m.toLowerCase().includes(form.equipment_brand.toLowerCase()))
  const filteredModelos = modelos.filter(m => m.toLowerCase().includes(form.equipment_model.toLowerCase()))

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/os/${id}`} className="rounded-xl border border-gray-200 dark:border-gray-700 p-2.5 hover:bg-gray-50 dark:hover:bg-gray-800">
          <ArrowLeft className="h-4 w-4 text-gray-500" />
        </Link>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">Editar</p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">OS-{String(osNumber).padStart(4, '0')}</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ─── Equipamento ────────────────────── */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <Monitor className="h-4 w-4" /> Equipamento
            </h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Tipo — dynamic from API */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de Equipamento</label>
                <select title="Tipo de equipamento" value={form.equipment_type} onChange={e => update('equipment_type', e.target.value)} className={inp}>
                  <option value="">Selecione...</option>
                  {equipTypes.length > 0 ? (
                    equipTypes.map(t => <option key={t} value={t}>{t}</option>)
                  ) : (
                    <>
                      <option>Impressora</option><option>Notebook</option><option>Monitor</option>
                      <option>Scanner</option><option>Computador</option><option>Outro</option>
                    </>
                  )}
                  {/* Se o valor atual não está na lista, adicionar */}
                  {form.equipment_type && !equipTypes.includes(form.equipment_type) && equipTypes.length > 0 && (
                    <option value={form.equipment_type}>{form.equipment_type}</option>
                  )}
                </select>
              </div>

              {/* Marca — searchable */}
              <div ref={marcaRef} className="relative">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Marca</label>
                <input type="text" value={form.equipment_brand}
                  onChange={e => { update('equipment_brand', e.target.value); setShowMarcaDropdown(true) }}
                  onFocus={() => setShowMarcaDropdown(true)}
                  placeholder="HP, Epson, Brother..." className={inp} />
                {showMarcaDropdown && filteredMarcas.length > 0 && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                    {filteredMarcas.slice(0, 15).map(m => (
                      <button key={m} type="button" onClick={() => { update('equipment_brand', m); setShowMarcaDropdown(false) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-950 text-gray-700 dark:text-gray-300">{m}</button>
                    ))}
                  </div>
                )}
              </div>

              {/* Modelo — searchable, depends on brand */}
              <div ref={modeloRef} className="relative">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Modelo</label>
                <input type="text" value={form.equipment_model}
                  onChange={e => { update('equipment_model', e.target.value); setShowModeloDropdown(true) }}
                  onFocus={() => setShowModeloDropdown(true)}
                  placeholder="LaserJet Pro M404..." className={inp} />
                {showModeloDropdown && filteredModelos.length > 0 && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                    {filteredModelos.slice(0, 15).map(m => (
                      <button key={m} type="button" onClick={() => { update('equipment_model', m); setShowModeloDropdown(false) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-950 text-gray-700 dark:text-gray-300">{m}</button>
                    ))}
                  </div>
                )}
              </div>

              {/* Serial */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">N. Serie</label>
                <input type="text" value={form.serial_number} onChange={e => update('serial_number', e.target.value)}
                  placeholder="VNC1234567" className={inp} />
              </div>
            </div>

            {/* Referência / Patrimônio */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Referencia / Patrimonio</label>
              <input type="text" value={form.reference} onChange={e => update('reference', e.target.value)}
                placeholder="Patrimonio do cliente, tag, ID interno..." className={inp} />
            </div>
          </div>
        </div>

        {/* ─── Problema e Diagnóstico ─────────── */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <Wrench className="h-4 w-4" /> Problema e Diagnostico
            </h2>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Defeito Relatado</label>
              <textarea value={form.reported_issue} onChange={e => update('reported_issue', e.target.value)}
                rows={3} placeholder="O que o cliente relatou..." className={inp + " resize-none"} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Diagnostico Tecnico</label>
              <textarea value={form.diagnosis} onChange={e => update('diagnosis', e.target.value)}
                rows={3} placeholder="Resultado da analise tecnica..." className={inp + " resize-none"} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Observacoes de Recepcao</label>
              <textarea value={form.reception_notes} onChange={e => update('reception_notes', e.target.value)}
                rows={2} placeholder="Estado do equipamento na entrada, acessorios, etc..." className={inp + " resize-none"} />
            </div>
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4">
              <label className="block text-sm font-medium text-amber-800 dark:text-amber-400 mb-1">Notas Internas (nao visivel ao cliente)</label>
              <textarea value={form.internal_notes} onChange={e => update('internal_notes', e.target.value)}
                rows={2} placeholder="Observacoes internas da equipe..." className={inp + " resize-none bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800"} />
            </div>
          </div>
        </div>

        {/* ─── Detalhes ──────────────────────── */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <Settings2 className="h-4 w-4" /> Detalhes
            </h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prioridade</label>
                <select title="Prioridade" value={form.priority} onChange={e => update('priority', e.target.value)} className={inp}>
                  <option value="LOW">Baixa</option>
                  <option value="MEDIUM">Media</option>
                  <option value="HIGH">Alta</option>
                  <option value="URGENT">Urgente</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de OS</label>
                <select title="Tipo de OS" value={form.os_type} onChange={e => update('os_type', e.target.value)} className={inp}>
                  <option value="AVULSO">Avulso</option>
                  <option value="BALCAO">Balcao</option>
                  <option value="COLETA">Coleta</option>
                  <option value="ENTREGA">Entrega</option>
                  <option value="CONTRATO">Contrato</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Custo Estimado (R$)</label>
                <input type="number" title="Custo estimado" value={form.estimated_cost / 100} step="0.01" min="0"
                  onChange={e => update('estimated_cost', Math.round(parseFloat(e.target.value || '0') * 100))}
                  placeholder="0.00" className={inp} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Previsao de Entrega</label>
                <input type="date" title="Previsao de entrega" value={form.estimated_delivery}
                  onChange={e => update('estimated_delivery', e.target.value)} className={inp} />
              </div>
            </div>
          </div>
        </div>

        {/* ─── Actions ───────────────────────── */}
        <div className="flex gap-3">
          <button type="button" onClick={() => router.push(`/os/${id}`)}
            className="px-5 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium">
            Cancelar
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors flex items-center justify-center gap-2 text-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Salvando...' : 'Salvar Alteracoes'}
          </button>
        </div>
      </form>
    </div>
  )
}
