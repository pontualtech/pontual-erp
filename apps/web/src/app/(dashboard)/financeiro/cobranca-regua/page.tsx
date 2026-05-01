'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, Power, MessageSquare, Mail, Smartphone, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type Channel = 'WHATSAPP' | 'EMAIL' | 'SMS'

interface RuleStep {
  id?: string
  step_order: number
  trigger_days_offset: number
  channel: Channel
  template_id: string | null
  apply_fee_pct: number
  apply_interest_pct_monthly: number
}

interface Rule {
  id: string
  name: string
  is_active: boolean
  applies_to_segment: string | null
  steps_count: number
  steps: RuleStep[]
}

const CHANNEL_LABELS: Record<Channel, { label: string; icon: any; color: string }> = {
  WHATSAPP: { label: 'WhatsApp', icon: MessageSquare, color: 'text-emerald-600' },
  EMAIL: { label: 'E-mail', icon: Mail, color: 'text-blue-600' },
  SMS: { label: 'SMS', icon: Smartphone, color: 'text-amber-600' },
}

function emptyStep(order: number): RuleStep {
  return {
    step_order: order,
    trigger_days_offset: order * 7 - 7,
    channel: 'WHATSAPP',
    template_id: null,
    apply_fee_pct: 0,
    apply_interest_pct_monthly: 0,
  }
}

function offsetLabel(offset: number) {
  if (offset === 0) return 'No vencimento'
  if (offset < 0) return `${Math.abs(offset)} dia${Math.abs(offset) > 1 ? 's' : ''} antes`
  return `${offset} dia${offset > 1 ? 's' : ''} de atraso`
}

export default function CobrancaReguaPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Rule | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/financeiro/v2/cobranca-rules')
      const j = await r.json()
      setRules(j.data ?? [])
    } catch {
      toast.error('Erro ao carregar réguas')
    } finally {
      setLoading(false)
    }
  }

  async function toggleActive(rule: Rule) {
    try {
      const r = await fetch(`/api/financeiro/v2/cobranca-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_active: !rule.is_active }),
      })
      if (!r.ok) throw new Error()
      toast.success(rule.is_active ? 'Régua desativada' : 'Régua ativada')
      load()
    } catch {
      toast.error('Falha ao alterar status')
    }
  }

  async function softDelete(rule: Rule) {
    if (!confirm(`Desativar "${rule.name}"? PaymentReminders existentes serão preservados.`)) return
    try {
      const r = await fetch(`/api/financeiro/v2/cobranca-rules/${rule.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      toast.success('Régua desativada')
      load()
    } catch {
      toast.error('Falha ao desativar')
    }
  }

  function openNew() {
    setEditing({
      id: '',
      name: '',
      is_active: true,
      applies_to_segment: null,
      steps_count: 0,
      steps: [emptyStep(1), emptyStep(2), emptyStep(3)],
    })
    setCreating(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/financeiro" className="rounded-md border p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Régua de Cobrança</h1>
            <p className="text-sm text-gray-500">Sequências automáticas de lembretes por canal e tempo</p>
          </div>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 rounded-md bg-blue-600 py-2 px-4 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Nova Régua
        </button>
      </div>

      {loading ? (
        <div className="rounded-lg border bg-white p-12 shadow-sm flex items-center justify-center text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando...
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border bg-white p-12 shadow-sm text-center">
          <p className="text-gray-500 mb-4">Nenhuma régua cadastrada</p>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 py-2 px-4 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Criar primeira régua
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {rules.map(rule => (
            <div key={rule.id} className={cn(
              'rounded-lg border bg-white p-5 shadow-sm',
              !rule.is_active && 'opacity-60'
            )}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-900">{rule.name}</h3>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      rule.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                    )}>
                      {rule.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </div>
                  {rule.applies_to_segment && (
                    <p className="text-xs text-gray-500 mt-1">Segmento: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{rule.applies_to_segment}</code></p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {rule.steps.map(step => {
                      const cfg = CHANNEL_LABELS[step.channel]
                      const Icon = cfg.icon
                      return (
                        <div key={step.step_order} className="flex items-center gap-1.5 rounded-md border bg-gray-50 px-2.5 py-1.5 text-xs">
                          <span className="font-medium text-gray-500">#{step.step_order}</span>
                          <Icon className={cn('h-3.5 w-3.5', cfg.color)} />
                          <span className="text-gray-700">{offsetLabel(step.trigger_days_offset)}</span>
                          {(step.apply_fee_pct > 0 || step.apply_interest_pct_monthly > 0) && (
                            <span className="text-amber-600 font-medium">
                              +{step.apply_fee_pct}% {step.apply_interest_pct_monthly > 0 && `+${step.apply_interest_pct_monthly}%/mês`}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleActive(rule)}
                    title={rule.is_active ? 'Desativar' : 'Ativar'}
                    className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <Power className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => { setEditing(rule); setCreating(false) }}
                    title="Editar"
                    className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => softDelete(rule)}
                    title="Desativar (soft-delete)"
                    className="rounded p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <RuleEditor
          initial={editing}
          isCreating={creating}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={() => { load(); setEditing(null); setCreating(false) }}
        />
      )}
    </div>
  )
}

function RuleEditor({
  initial,
  isCreating,
  onClose,
  onSaved,
}: {
  initial: Rule
  isCreating: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [isActive, setIsActive] = useState(initial.is_active)
  const [segment, setSegment] = useState(initial.applies_to_segment ?? '')
  const [steps, setSteps] = useState<RuleStep[]>(initial.steps)
  const [saving, setSaving] = useState(false)

  function updateStep(idx: number, patch: Partial<RuleStep>) {
    setSteps(s => s.map((st, i) => i === idx ? { ...st, ...patch } : st))
  }
  function addStep() {
    setSteps(s => [...s, emptyStep(s.length + 1)])
  }
  function removeStep(idx: number) {
    setSteps(s => s.filter((_, i) => i !== idx).map((st, i) => ({ ...st, step_order: i + 1 })))
  }

  async function save() {
    if (!name.trim()) {
      toast.error('Nome é obrigatório')
      return
    }
    if (steps.length === 0) {
      toast.error('Pelo menos 1 passo')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        is_active: isActive,
        applies_to_segment: segment.trim() || null,
        steps: steps.map((s, i) => ({
          step_order: i + 1,
          trigger_days_offset: Number(s.trigger_days_offset),
          channel: s.channel,
          template_id: s.template_id || null,
          apply_fee_pct: Number(s.apply_fee_pct),
          apply_interest_pct_monthly: Number(s.apply_interest_pct_monthly),
        })),
      }
      const url = isCreating
        ? '/api/financeiro/v2/cobranca-rules'
        : `/api/financeiro/v2/cobranca-rules/${initial.id}`
      const r = await fetch(url, {
        method: isCreating ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error ?? 'Erro')
      }
      toast.success(isCreating ? 'Régua criada' : 'Régua atualizada')
      onSaved()
    } catch (e: any) {
      toast.error(`Falha: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-lg font-semibold">{isCreating ? 'Nova Régua' : 'Editar Régua'}</h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Nome *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full rounded-md border py-2 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Ex: Régua Padrão B2B"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Segmento (opcional)</label>
              <input
                value={segment}
                onChange={e => setSegment(e.target.value)}
                className="w-full rounded-md border py-2 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="ALL ou CUSTOMER_TAG:premium"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span>Régua ativa</span>
          </label>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Passos da régua</label>
              <button
                type="button"
                onClick={addStep}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar passo
              </button>
            </div>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 rounded-md border bg-gray-50 p-3 items-end">
                  <div className="col-span-1">
                    <label className="block text-[10px] font-medium uppercase text-gray-400">#</label>
                    <div className="rounded bg-white border py-2 px-2 text-center text-sm font-medium">{i + 1}</div>
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[10px] font-medium uppercase text-gray-400">Dias offset</label>
                    <input
                      type="number"
                      aria-label={`Dias offset do passo ${i + 1}`}
                      value={step.trigger_days_offset}
                      onChange={e => updateStep(i, { trigger_days_offset: Number(e.target.value) })}
                      className="w-full rounded border py-1.5 px-2 text-sm"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[10px] font-medium uppercase text-gray-400">Canal</label>
                    <select
                      aria-label={`Canal do passo ${i + 1}`}
                      value={step.channel}
                      onChange={e => updateStep(i, { channel: e.target.value as Channel })}
                      className="w-full rounded border py-1.5 px-2 text-sm bg-white"
                    >
                      {(Object.keys(CHANNEL_LABELS) as Channel[]).map(k => (
                        <option key={k} value={k}>{CHANNEL_LABELS[k].label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-medium uppercase text-gray-400">Multa %</label>
                    <input
                      type="number"
                      step="0.01"
                      aria-label={`Multa em percentual do passo ${i + 1}`}
                      value={step.apply_fee_pct}
                      onChange={e => updateStep(i, { apply_fee_pct: Number(e.target.value) })}
                      className="w-full rounded border py-1.5 px-2 text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-medium uppercase text-gray-400">Juros %/mês</label>
                    <input
                      type="number"
                      step="0.01"
                      aria-label={`Juros mensal em percentual do passo ${i + 1}`}
                      value={step.apply_interest_pct_monthly}
                      onChange={e => updateStep(i, { apply_interest_pct_monthly: Number(e.target.value) })}
                      className="w-full rounded border py-1.5 px-2 text-sm"
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeStep(i)}
                      disabled={steps.length === 1}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      title="Remover"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t bg-gray-50 px-5 py-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border bg-white py-2 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-blue-600 py-2 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
