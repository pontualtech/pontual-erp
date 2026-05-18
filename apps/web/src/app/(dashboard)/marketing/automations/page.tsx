'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, Zap, Mail, MessageCircle, Webhook, CheckSquare, Edit2, Power } from 'lucide-react'
import { EmptyState } from '@/components/marketing/EmptyState'
import { STAGES, getStage } from '@/lib/marketing/stages'
import { formatRelative } from '@/lib/marketing/format'

interface Automation {
  id: string
  name: string
  from_stage: string | null
  to_stage: string | null
  action_type: 'email' | 'whatsapp' | 'webhook' | 'task'
  payload: any
  delay_minutes: number
  active: boolean
  created_at: string
  updated_at: string
}

const ACTION_META: Record<string, { label: string; icon: any; color: string }> = {
  email: { label: 'Email', icon: Mail, color: 'text-blue-600 dark:text-blue-400' },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, color: 'text-green-600 dark:text-green-400' },
  webhook: { label: 'Webhook', icon: Webhook, color: 'text-purple-600 dark:text-purple-400' },
  task: { label: 'Tarefa', icon: CheckSquare, color: 'text-amber-600 dark:text-amber-400' },
}

export default function AutomationsPage() {
  const [items, setItems] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Automation | null>(null)

  async function fetchItems() {
    setLoading(true)
    try {
      const r = await fetch('/api/marketing/automations')
      if (r.ok) setItems((await r.json()).data?.automations || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchItems() }, [])

  async function toggleActive(a: Automation) {
    const r = await fetch(`/api/marketing/automations/${a.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !a.active }),
    })
    if (r.ok) fetchItems()
  }

  async function handleDelete(a: Automation) {
    if (!confirm(`Apagar a automação "${a.name}"?\n\nO histórico de execuções também será removido.`)) return
    const r = await fetch(`/api/marketing/automations/${a.id}`, { method: 'DELETE' })
    if (r.ok) fetchItems()
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Zap className="h-6 w-6 text-amber-500" />
            Automações
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Dispare email, WhatsApp, webhook ou tarefa quando um contato muda de fase no Kanban.
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
        >
          <Plus className="h-4 w-4" />
          Nova automação
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Nenhuma automação ainda"
          description="Crie sua primeira automação. Ela dispara automaticamente quando um contato muda de fase no Kanban."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Nome</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Gatilho</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Ação</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Atualizada</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.map(a => {
                const meta = ACTION_META[a.action_type]
                const Icon = meta?.icon
                const fromLabel = a.from_stage ? getStage(a.from_stage)?.label : 'Qualquer'
                const toLabel = a.to_stage ? getStage(a.to_stage)?.label : 'Qualquer'
                return (
                  <tr key={a.id} className={a.active ? '' : 'opacity-50'}>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(a)}
                        title={a.active ? 'Pausar' : 'Ativar'}
                        className={`inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium ${a.active ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}
                      >
                        <Power className="h-3 w-3 mr-1" />
                        {a.active ? 'Ativa' : 'Pausada'}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{a.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      <span className="text-gray-400">de</span> <span className="font-medium">{fromLabel}</span>{' '}
                      <span className="text-gray-400">→</span>{' '}
                      <span className="font-medium">{toLabel}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-sm ${meta?.color}`}>
                        {Icon ? <Icon className="h-4 w-4" /> : null}
                        {meta?.label || a.action_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatRelative(a.updated_at)}</td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <button
                        onClick={() => { setEditing(a); setShowForm(true) }}
                        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                        title="Editar"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(a)}
                        className="rounded p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                        title="Apagar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <AutomationForm
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSaved={() => { setShowForm(false); setEditing(null); fetchItems() }}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Form (modal)
// ----------------------------------------------------------------------------

function AutomationForm({ editing, onClose, onSaved }: {
  editing: Automation | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(editing?.name || '')
  const [fromStage, setFromStage] = useState(editing?.from_stage || '')
  const [toStage, setToStage] = useState(editing?.to_stage || '')
  const [actionType, setActionType] = useState<Automation['action_type']>(editing?.action_type || 'email')
  const [payload, setPayload] = useState<any>(editing?.payload || defaultPayload('email'))
  const [delayMinutes, setDelayMinutes] = useState(editing?.delay_minutes || 0)
  const [active, setActive] = useState(editing?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function defaultPayload(type: string): any {
    switch (type) {
      case 'email': return { subject: '', html: '', campaignTag: 'automation_' + Math.random().toString(36).slice(2, 8) }
      case 'whatsapp': return { templateName: '', templateLanguage: 'pt_BR', variables: [] }
      case 'webhook': return { url: '', method: 'POST', bodyTemplate: '' }
      case 'task': return { title: '', description: '', dueDays: 1 }
      default: return {}
    }
  }

  function changeActionType(t: Automation['action_type']) {
    setActionType(t)
    setPayload(defaultPayload(t))
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const body = {
        name,
        from_stage: fromStage,
        to_stage: toStage,
        action_type: actionType,
        payload,
        delay_minutes: delayMinutes,
        active,
      }
      const r = editing
        ? await fetch(`/api/marketing/automations/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/marketing/automations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(j?.error || `Erro ${r.status}`)
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-gray-900 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editing ? 'Editar automação' : 'Nova automação'}
          </h2>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Boas-vindas ao virar cliente"
              maxLength={120}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            />
          </div>

          {/* Gatilho */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">De (fase origem)</label>
              <select value={fromStage} onChange={e => setFromStage(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
                <option value="">Qualquer fase</option>
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.emoji} {s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Para (fase destino)</label>
              <select value={toStage} onChange={e => setToStage(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
                <option value="">Qualquer fase</option>
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.emoji} {s.label}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-500">Pelo menos um dos dois precisa ser preenchido.</p>

          {/* Action type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Ação</label>
            <div className="grid grid-cols-4 gap-2">
              {(['email', 'whatsapp', 'webhook', 'task'] as const).map(t => {
                const meta = ACTION_META[t]
                const Icon = meta.icon
                const selected = actionType === t
                return (
                  <button key={t} type="button" onClick={() => changeActionType(t)}
                    className={`flex flex-col items-center gap-1 rounded-md border p-3 text-sm transition ${selected ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                    <Icon className="h-5 w-5" />
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Payload por tipo */}
          {actionType === 'email' && (
            <div className="space-y-3 rounded-md border border-gray-200 dark:border-gray-700 p-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Assunto</label>
                <input type="text" value={payload.subject || ''} onChange={e => setPayload({ ...payload, subject: e.target.value })}
                  placeholder="Olá {{nome}}, bem-vindo!" maxLength={200}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">HTML (use {`{{nome}}`} pra personalizar)</label>
                <textarea rows={6} value={payload.html || ''} onChange={e => setPayload({ ...payload, html: e.target.value })}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-xs font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tag campanha (a-z, 0-9, _)</label>
                <input type="text" value={payload.campaignTag || ''} onChange={e => setPayload({ ...payload, campaignTag: e.target.value.toLowerCase() })}
                  pattern="[a-z0-9_]+" maxLength={60}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
              </div>
            </div>
          )}

          {actionType === 'webhook' && (
            <div className="space-y-3 rounded-md border border-gray-200 dark:border-gray-700 p-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">URL</label>
                <input type="url" value={payload.url || ''} onChange={e => setPayload({ ...payload, url: e.target.value })}
                  placeholder="https://hook.exemplo.com/contato-mudou"
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Método</label>
                <select value={payload.method || 'POST'} onChange={e => setPayload({ ...payload, method: e.target.value })}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
                  <option>POST</option><option>GET</option><option>PUT</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Body template (JSON com {`{{email}}`}, {`{{nome}}`}, {`{{telefone}}`}, {`{{to_stage}}`})</label>
                <textarea rows={4} value={payload.bodyTemplate || ''} onChange={e => setPayload({ ...payload, bodyTemplate: e.target.value })}
                  placeholder={`{"email": "{{email}}", "nome": "{{nome}}", "stage": "{{to_stage}}"}`}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-xs font-mono" />
              </div>
            </div>
          )}

          {(actionType === 'whatsapp' || actionType === 'task') && (
            <div className="rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-400">
              ⚠️ Ação <strong>{ACTION_META[actionType].label}</strong> está em fase de planejamento. A automação será salva mas as execuções ficam como "skipped" até implementarmos o canal.
            </div>
          )}

          {/* Delay */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Atraso (minutos)</label>
            <input type="number" min={0} max={43200} value={delayMinutes} onChange={e => setDelayMinutes(parseInt(e.target.value) || 0)}
              className="w-32 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
            <p className="text-xs text-gray-500 mt-1">0 = dispara imediato. &gt;0 ainda não implementado no MVP.</p>
          </div>

          {/* Active */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
              className="rounded border-gray-300" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Ativa</span>
          </label>

          {error && <div className="rounded-md bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">{error}</div>}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
            Cancelar
          </button>
          <button onClick={save} disabled={saving || !name}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            {saving ? 'Salvando…' : editing ? 'Salvar' : 'Criar automação'}
          </button>
        </div>
      </div>
    </div>
  )
}
