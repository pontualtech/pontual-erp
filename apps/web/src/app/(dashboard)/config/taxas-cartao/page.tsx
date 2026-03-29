'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/use-auth'
import { ArrowLeft, Save, Plus, Trash2, CreditCard } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface InstallmentRange {
  from: number
  to: number
  fee_pct: number
  days_to_receive: number
}

interface CardFeeConfig {
  id?: string
  name: string
  credit: {
    installments: InstallmentRange[]
  }
  debit: {
    fee_pct: number
    days_to_receive: number
  }
  anticipation: {
    fee_pct_per_day: number
    enabled: boolean
  }
}

const defaultConfig: CardFeeConfig = {
  name: '',
  credit: {
    installments: [
      { from: 1, to: 1, fee_pct: 2.99, days_to_receive: 30 },
      { from: 2, to: 6, fee_pct: 4.99, days_to_receive: 30 },
      { from: 7, to: 12, fee_pct: 5.99, days_to_receive: 30 },
    ],
  },
  debit: { fee_pct: 1.99, days_to_receive: 1 },
  anticipation: { fee_pct_per_day: 0.04, enabled: true },
}

export default function ConfigTaxasCartaoPage() {
  const { isAdmin } = useAuth()
  const [configs, setConfigs] = useState<CardFeeConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [form, setForm] = useState<CardFeeConfig>(defaultConfig)

  async function loadConfigs() {
    const res = await fetch('/api/financeiro/card-fees')
    const data = await res.json()
    const items: CardFeeConfig[] = (data.data || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      credit: c.credit || { installments: c.installments?.map((i: any) => ({ ...i, days_to_receive: c.days_to_receive || 30 })) || [] },
      debit: c.debit || { fee_pct: c.debit_fee_pct || 0, days_to_receive: c.debit_days_to_receive || 1 },
      anticipation: c.anticipation || { fee_pct_per_day: 0.04, enabled: true },
    }))
    setConfigs(items)
  }

  useEffect(() => { loadConfigs().finally(() => setLoading(false)) }, [])

  function addCreditRange() {
    const ranges = form.credit.installments
    const last = ranges[ranges.length - 1]
    setForm(f => ({
      ...f,
      credit: {
        installments: [...f.credit.installments, {
          from: (last?.to || 0) + 1,
          to: (last?.to || 0) + 3,
          fee_pct: last ? last.fee_pct + 1 : 3.99,
          days_to_receive: last?.days_to_receive || 30,
        }],
      },
    }))
  }

  function removeCreditRange(idx: number) {
    setForm(f => ({ ...f, credit: { installments: f.credit.installments.filter((_, i) => i !== idx) } }))
  }

  function updateCreditRange(idx: number, field: string, value: number) {
    setForm(f => ({
      ...f,
      credit: {
        installments: f.credit.installments.map((inst, i) => i === idx ? { ...inst, [field]: value } : inst),
      },
    }))
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Nome da operadora e obrigatorio'); return }
    if (form.credit.installments.length === 0) { toast.error('Adicione pelo menos uma faixa de credito'); return }
    setSaving(true)
    try {
      const key = form.id || `card_fee.${form.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`
      const value = JSON.stringify({
        name: form.name,
        credit: form.credit,
        debit: form.debit,
        anticipation: form.anticipation,
        // Backwards compat
        installments: form.credit.installments,
        debit_fee_pct: form.debit.fee_pct,
        days_to_receive: form.credit.installments[0]?.days_to_receive || 30,
      })
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: [{ key, value, type: 'json' }] }),
      })
      toast.success('Taxas salvas!')
      await loadConfigs()
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

  if (!isAdmin) return <div className="p-8 text-center text-sm text-gray-400">Apenas administradores.</div>
  if (loading) return <div className="p-8 text-center text-sm text-gray-400">Carregando...</div>

  const inp = 'w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-sm'

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <CreditCard className="h-6 w-6" /> Taxas de Operadora de Cartao
          </h1>
          <p className="text-sm text-gray-500">Taxas de credito (por faixa), debito e antecipacao</p>
        </div>
      </div>

      {/* Existing configs */}
      {configs.map((config, idx) => (
        <div key={config.id || idx} className="rounded-lg border bg-white dark:bg-gray-800 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-purple-500" /> {config.name}
            </h3>
            <div className="flex gap-2">
              <button onClick={() => { setEditIdx(idx); setForm({ ...config }) }} className="text-sm text-blue-600 hover:underline">Editar</button>
              <button onClick={() => handleDelete(config)} className="text-sm text-red-500 hover:underline">Remover</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Credit */}
            <div>
              <h4 className="text-xs font-semibold uppercase text-gray-400 mb-2">Credito</h4>
              <div className="space-y-1">
                {config.credit.installments.map((inst, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-600">{inst.from === inst.to ? `${inst.from}x` : `${inst.from}-${inst.to}x`}</span>
                    <span className="font-medium">{inst.fee_pct}% <span className="text-gray-400 text-xs">({inst.days_to_receive}d)</span></span>
                  </div>
                ))}
              </div>
            </div>

            {/* Debit + Anticipation */}
            <div className="space-y-3">
              <div>
                <h4 className="text-xs font-semibold uppercase text-gray-400 mb-2">Debito</h4>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Taxa</span>
                  <span className="font-medium">{config.debit.fee_pct}% <span className="text-gray-400 text-xs">({config.debit.days_to_receive}d)</span></span>
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase text-gray-400 mb-2">Antecipacao</h4>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{config.anticipation.enabled ? 'Ativa' : 'Desativada'}</span>
                  <span className="font-medium">{config.anticipation.fee_pct_per_day}%/dia</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Edit/New form */}
      {editIdx !== null ? (
        <div className="rounded-lg border bg-white dark:bg-gray-800 p-6 shadow-sm space-y-6">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            {editIdx === -1 ? 'Nova Operadora' : `Editar ${form.name}`}
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome da operadora *</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Rede, Cielo, Stone..." className={inp + ' max-w-xs'} />
          </div>

          {/* === CREDITO === */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-800 dark:text-gray-200">Credito — Faixas de Parcelas</h3>
              <button type="button" onClick={addCreditRange} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
                <Plus className="h-3.5 w-3.5" /> Faixa
              </button>
            </div>
            <div className="space-y-2">
              {form.credit.installments.map((inst, i) => (
                <div key={i} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-lg p-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">De</span>
                    <input type="number" min="1" max="24" value={inst.from}
                      onChange={e => updateCreditRange(i, 'from', Number(e.target.value))}
                      className="w-14 px-2 py-1 border rounded text-sm text-center" />
                    <span className="text-sm text-gray-500">a</span>
                    <input type="number" min="1" max="24" value={inst.to}
                      onChange={e => updateCreditRange(i, 'to', Number(e.target.value))}
                      className="w-14 px-2 py-1 border rounded text-sm text-center" />
                    <span className="text-sm text-gray-500">x</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">Taxa:</span>
                    <input type="number" step="0.01" min="0" max="100" value={inst.fee_pct}
                      onChange={e => updateCreditRange(i, 'fee_pct', Number(e.target.value))}
                      className="w-20 px-2 py-1 border rounded text-sm text-center" />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">Prazo:</span>
                    <input type="number" min="0" max="365" value={inst.days_to_receive}
                      onChange={e => updateCreditRange(i, 'days_to_receive', Number(e.target.value))}
                      className="w-16 px-2 py-1 border rounded text-sm text-center" />
                    <span className="text-sm text-gray-500">dias</span>
                  </div>
                  {form.credit.installments.length > 1 && (
                    <button type="button" onClick={() => removeCreditRange(i)} className="text-red-400 hover:text-red-600 ml-auto">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* === DEBITO === */}
          <div className="border-t pt-4">
            <h3 className="font-medium text-gray-800 dark:text-gray-200 mb-3">Debito</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Taxa (%)</label>
                <input type="number" step="0.01" min="0" max="100" value={form.debit.fee_pct}
                  onChange={e => setForm(f => ({ ...f, debit: { ...f.debit, fee_pct: Number(e.target.value) } }))}
                  className={inp} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Prazo recebimento (dias)</label>
                <input type="number" min="0" max="365" value={form.debit.days_to_receive}
                  onChange={e => setForm(f => ({ ...f, debit: { ...f.debit, days_to_receive: Number(e.target.value) } }))}
                  className={inp} />
              </div>
            </div>
          </div>

          {/* === ANTECIPACAO === */}
          <div className="border-t pt-4">
            <h3 className="font-medium text-gray-800 dark:text-gray-200 mb-3">Antecipacao de Recebiveis</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Taxa por dia antecipado (%)</label>
                <input type="number" step="0.001" min="0" max="1" value={form.anticipation.fee_pct_per_day}
                  onChange={e => setForm(f => ({ ...f, anticipation: { ...f.anticipation, fee_pct_per_day: Number(e.target.value) } }))}
                  className={inp} />
                <p className="text-xs text-gray-400 mt-1">Ex: 0.04% = R$ 0,40 por dia a cada R$ 1.000</p>
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.anticipation.enabled}
                    onChange={e => setForm(f => ({ ...f, anticipation: { ...f.anticipation, enabled: e.target.checked } }))}
                    className="rounded border-gray-300 h-4 w-4" />
                  <span className="text-sm text-gray-700">Permitir antecipacao</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              <Save className="h-4 w-4" /> {saving ? 'Salvando...' : 'Salvar'}
            </button>
            <button onClick={() => { setEditIdx(null); setForm(defaultConfig) }}
              className="rounded-lg border px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setEditIdx(-1); setForm(defaultConfig) }}
          className="flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-5 py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 w-full justify-center">
          <Plus className="h-4 w-4" /> Adicionar operadora
        </button>
      )}
    </div>
  )
}
