'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'

export default function EditarOSPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [osNumber, setOsNumber] = useState(0)

  const [form, setForm] = useState({
    equipment_type: '',
    equipment_brand: '',
    equipment_model: '',
    serial_number: '',
    reported_issue: '',
    diagnosis: '',
    reception_notes: '',
    internal_notes: '',
    priority: 'MEDIUM',
    os_type: 'BALCAO',
    estimated_cost: 0,
    estimated_delivery: '',
  })

  useEffect(() => {
    fetch(`/api/os/${id}`)
      .then(r => r.json())
      .then(d => {
        const os = d.data
        if (!os) { toast.error('OS não encontrada'); router.push('/os'); return }
        setOsNumber(os.os_number)
        setForm({
          equipment_type: os.equipment_type || '',
          equipment_brand: os.equipment_brand || '',
          equipment_model: os.equipment_model || '',
          serial_number: os.serial_number || '',
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
      .catch(() => { toast.error('Erro ao carregar OS'); router.push('/os') })
      .finally(() => setLoading(false))
  }, [id, router])

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
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-12 text-center text-gray-400">Carregando...</div>

  const inp = "w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors"

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/os/${id}`} className="rounded-md border p-2 hover:bg-gray-50">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Editar OS-{String(osNumber).padStart(4, '0')}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Equipment */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Equipamento</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <select value={form.equipment_type} onChange={e => update('equipment_type', e.target.value)} className={inp}>
                <option value="">Selecione</option>
                <option>Impressora</option>
                <option>Notebook</option>
                <option>Monitor</option>
                <option>Scanner</option>
                <option>Computador</option>
                <option>Outro</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Marca</label>
              <input type="text" value={form.equipment_brand} onChange={e => update('equipment_brand', e.target.value)}
                placeholder="HP, Epson, Brother..." className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Modelo</label>
              <input type="text" value={form.equipment_model} onChange={e => update('equipment_model', e.target.value)}
                placeholder="LaserJet Pro M404" className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nº Série</label>
              <input type="text" value={form.serial_number} onChange={e => update('serial_number', e.target.value)}
                placeholder="VNC1234567" className={inp} />
            </div>
          </div>
        </div>

        {/* Problem & Diagnosis */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Problema e Diagnóstico</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Defeito relatado pelo cliente</label>
            <textarea value={form.reported_issue} onChange={e => update('reported_issue', e.target.value)}
              rows={3} placeholder="Descreva o problema..." className={inp + " resize-none"} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Diagnóstico técnico</label>
            <textarea value={form.diagnosis} onChange={e => update('diagnosis', e.target.value)}
              rows={3} placeholder="Diagnóstico do técnico..." className={inp + " resize-none"} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Observações de recepção</label>
            <textarea value={form.reception_notes} onChange={e => update('reception_notes', e.target.value)}
              rows={2} placeholder="Estado do equipamento na entrada..." className={inp + " resize-none"} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas internas</label>
            <textarea value={form.internal_notes} onChange={e => update('internal_notes', e.target.value)}
              rows={2} placeholder="Notas visíveis apenas internamente..." className={inp + " resize-none"} />
          </div>
        </div>

        {/* Priority, Type, Cost, Delivery */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Detalhes</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prioridade</label>
              <select value={form.priority} onChange={e => update('priority', e.target.value)} className={inp}>
                <option value="LOW">Baixa</option>
                <option value="MEDIUM">Média</option>
                <option value="HIGH">Alta</option>
                <option value="URGENT">Urgente</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de OS</label>
              <select value={form.os_type} onChange={e => update('os_type', e.target.value)} className={inp}>
                <option value="BALCAO">Balcão</option>
                <option value="COLETA">Coleta</option>
                <option value="ENTREGA">Entrega</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Custo estimado (R$)</label>
              <input type="number" value={form.estimated_cost / 100} step="0.01" min="0"
                onChange={e => update('estimated_cost', Math.round(parseFloat(e.target.value || '0') * 100))}
                placeholder="0,00" className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Previsão de entrega</label>
              <input type="date" value={form.estimated_delivery}
                onChange={e => update('estimated_delivery', e.target.value)}
                className={inp} />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button type="button" onClick={() => router.push(`/os/${id}`)}
            className="px-5 py-2.5 border rounded-md text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50
              font-medium transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </form>
    </div>
  )
}
