'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/use-auth'
import { ArrowLeft, Save, Plus, Trash2, CreditCard } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface CardFeeConfig {
  id?: string
  name: string
  installments: { from: number; to: number; fee_pct: number }[]
  debit_fee_pct: number
  days_to_receive: number
}

const defaultConfig: CardFeeConfig = {
  name: '',
  installments: [{ from: 1, to: 1, fee_pct: 2.99 }],
  debit_fee_pct: 1.99,
  days_to_receive: 30,
}

export default function ConfigTaxasCartaoPage() {
  const { isAdmin } = useAuth()
  const [configs, setConfigs] = useState<CardFeeConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [form, setForm] = useState<CardFeeConfig>(defaultConfig)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        const all = data.data || {}
        const taxas = all.card_fee || {}
        const items: CardFeeConfig[] = []
        for (const [key, setting] of Object.entries(taxas) as [string, any][]) {
          try {
            const parsed = JSON.parse(setting.value)
            items.push({ id: key, ...parsed })
          } catch {}
        }
        setConfigs(items)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function addInstallmentRange() {
    const last = form.installments[form.installments.length - 1]
    setForm(f => ({
      ...f,
      installments: [...f.installments, { from: (last?.to || 0) + 1, to: (last?.to || 0) + 3, fee_pct: last ? last.fee_pct + 1 : 3.99 }],
    }))
  }

  function removeInstallmentRange(idx: number) {
    setForm(f => ({ ...f, installments: f.installments.filter((_, i) => i !== idx) }))
  }

  function updateInstallment(idx: number, field: string, value: number) {
    setForm(f => ({
      ...f,
      installments: f.installments.map((inst, i) => i === idx ? { ...inst, [field]: value } : inst),
    }))
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Nome da operadora e obrigatorio'); return }
    if (form.installments.length === 0) { toast.error('Adicione pelo menos uma faixa de parcelas'); return }

    setSaving(true)
    try {
      const key = form.id || `card_fee.${form.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`
      const value = JSON.stringify({
        name: form.name,
        installments: form.installments,
        debit_fee_pct: form.debit_fee_pct,
        days_to_receive: form.days_to_receive,
      })

      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: [{ key, value, type: 'json' }] }),
      })

      toast.success('Taxas salvas!')

      // Reload
      const res = await fetch('/api/settings')
      const data = await res.json()
      const taxas = data.data?.card_fee || {}
      const items: CardFeeConfig[] = []
      for (const [k, s] of Object.entries(taxas) as [string, any][]) {
        try { items.push({ id: k, ...JSON.parse(s.value) }) } catch {}
      }
      setConfigs(items)
      setEditIdx(null)
      setForm(defaultConfig)
    } catch { toast.error('Erro ao salvar') }
    finally { setSaving(false) }
  }

  async function handleDelete(config: CardFeeConfig) {
    if (!confirm(`Remover taxas de ${config.name}?`)) return
    if (!config.id) return
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: [{ key: config.id, value: '', type: 'deleted' }] }),
    })
    setConfigs(prev => prev.filter(c => c.id !== config.id))
    toast.success('Removido')
  }

  function startEdit(idx: number) {
    setEditIdx(idx)
    setForm({ ...configs[idx] })
  }

  function startNew() {
    setEditIdx(-1)
    setForm({ ...defaultConfig })
  }

  if (!isAdmin) return <div className="p-8 text-center text-sm text-gray-400">Apenas administradores.</div>
  if (loading) return <div className="p-8 text-center text-sm text-gray-400">Carregando...</div>

  const inp = 'w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-sm'

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <CreditCard className="h-6 w-6" />
            Taxas de Operadora de Cartao
          </h1>
          <p className="text-sm text-gray-500">Configure as taxas por operadora e faixa de parcelas</p>
        </div>
      </div>

      {/* Existing configs */}
      {configs.length > 0 && (
        <div className="space-y-3">
          {configs.map((config, idx) => (
            <div key={config.id || idx} className="rounded-lg border bg-white dark:bg-gray-800 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-purple-500" />
                  {config.name}
                </h3>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(idx)} className="text-sm text-blue-600 hover:underline">Editar</button>
                  <button onClick={() => handleDelete(config)} className="text-sm text-red-500 hover:underline">Remover</button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Debito:</span>
                  <span className="ml-1 font-medium">{config.debit_fee_pct}%</span>
                </div>
                <div>
                  <span className="text-gray-500">Prazo recebimento:</span>
                  <span className="ml-1 font-medium">{config.days_to_receive} dias</span>
                </div>
              </div>
              <div className="mt-2">
                <span className="text-xs text-gray-500 uppercase font-medium">Credito por faixa:</span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {config.installments.map((inst, i) => (
                    <span key={i} className="inline-block bg-purple-50 text-purple-700 rounded px-2 py-0.5 text-xs font-medium">
                      {inst.from === inst.to ? `${inst.from}x` : `${inst.from}-${inst.to}x`}: {inst.fee_pct}%
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit form */}
      {editIdx !== null ? (
        <div className="rounded-lg border bg-white dark:bg-gray-800 p-6 shadow-sm space-y-5">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            {editIdx === -1 ? 'Nova Operadora' : `Editar ${form.name}`}
          </h2>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome da operadora *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Rede, Cielo, Stone..." className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Taxa debito (%)</label>
              <input type="number" step="0.01" min="0" max="100" value={form.debit_fee_pct}
                onChange={e => setForm(f => ({ ...f, debit_fee_pct: Number(e.target.value) }))} className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prazo recebimento (dias)</label>
              <input type="number" min="0" max="365" value={form.days_to_receive}
                onChange={e => setForm(f => ({ ...f, days_to_receive: Number(e.target.value) }))} className={inp} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Faixas de parcelas (credito)</label>
              <button type="button" onClick={addInstallmentRange}
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
                <Plus className="h-3.5 w-3.5" /> Adicionar faixa
              </button>
            </div>
            <div className="space-y-2">
              {form.installments.map((inst, i) => (
                <div key={i} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">De</span>
                    <input type="number" min="1" max="24" value={inst.from}
                      onChange={e => updateInstallment(i, 'from', Number(e.target.value))}
                      className="w-16 px-2 py-1 border rounded text-sm text-center" />
                    <span className="text-sm text-gray-500">a</span>
                    <input type="number" min="1" max="24" value={inst.to}
                      onChange={e => updateInstallment(i, 'to', Number(e.target.value))}
                      className="w-16 px-2 py-1 border rounded text-sm text-center" />
                    <span className="text-sm text-gray-500">parcelas</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">Taxa:</span>
                    <input type="number" step="0.01" min="0" max="100" value={inst.fee_pct}
                      onChange={e => updateInstallment(i, 'fee_pct', Number(e.target.value))}
                      className="w-20 px-2 py-1 border rounded text-sm text-center" />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                  {form.installments.length > 1 && (
                    <button type="button" onClick={() => removeInstallmentRange(i)}
                      className="text-red-400 hover:text-red-600 ml-auto">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              <Save className="h-4 w-4" />
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            <button onClick={() => { setEditIdx(null); setForm(defaultConfig) }}
              className="rounded-lg border px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button onClick={startNew}
          className="flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-5 py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 w-full justify-center">
          <Plus className="h-4 w-4" /> Adicionar operadora
        </button>
      )}
    </div>
  )
}
