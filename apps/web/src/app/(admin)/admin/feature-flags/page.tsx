'use client'

import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Loader2, Flag, X, Building2 } from 'lucide-react'
import { toast } from 'sonner'

type Strategy = 'OFF' | 'ON' | 'PERCENTAGE' | 'TENANT_LIST'

interface TenantOverride {
  company_id: string
  company_name: string
  enabled: boolean
  enabled_at: string
}

interface FeatureFlag {
  key: string
  description: string | null
  strategy: Strategy
  rollout_pct: number
  created_at: string
  updated_at: string
  tenant_overrides: TenantOverride[]
}

interface Company {
  id: string
  name: string
}

const STRATEGY_BADGE: Record<Strategy, { label: string; className: string }> = {
  OFF: { label: 'OFF', className: 'bg-gray-700 text-gray-300' },
  ON: { label: 'ON (todos)', className: 'bg-emerald-700 text-emerald-100' },
  PERCENTAGE: { label: 'Rollout %', className: 'bg-blue-700 text-blue-100' },
  TENANT_LIST: { label: 'Por tenant', className: 'bg-amber-700 text-amber-100' },
}

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<FeatureFlag | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [flagsRes, companiesRes] = await Promise.all([
        fetch('/api/admin/feature-flags'),
        fetch('/api/admin/empresas').catch(() => null),
      ])
      const fj = await flagsRes.json()
      setFlags(fj.data ?? [])
      if (companiesRes && companiesRes.ok) {
        const cj = await companiesRes.json()
        setCompanies(cj.data ?? [])
      }
    } catch {
      toast.error('Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }

  async function deleteFlag(key: string) {
    if (!confirm(`Excluir flag "${key}"? Removerá todos os overrides.`)) return
    try {
      const r = await fetch(`/api/admin/feature-flags/${encodeURIComponent(key)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      toast.success('Flag excluída')
      load()
    } catch {
      toast.error('Falha ao excluir')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Flag className="h-6 w-6 text-amber-400" />
          <div>
            <h1 className="text-2xl font-bold">Feature Flags</h1>
            <p className="text-sm text-gray-400">Controle gradual de rollout por tenant ou percentual</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
        >
          <Plus className="h-4 w-4" />
          Nova flag
        </button>
      </div>

      {loading ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-12 flex items-center justify-center text-gray-500">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando...
        </div>
      ) : flags.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-12 text-center">
          <p className="text-gray-400 mb-4">Nenhuma flag cadastrada</p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
          >
            <Plus className="h-4 w-4" /> Criar primeira flag
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {flags.map(flag => {
            const badge = STRATEGY_BADGE[flag.strategy]
            return (
              <div key={flag.key} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-base font-mono text-amber-300">{flag.key}</code>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${badge.className}`}>
                        {badge.label}
                      </span>
                      {flag.strategy === 'PERCENTAGE' && (
                        <span className="text-xs text-blue-300">{flag.rollout_pct}%</span>
                      )}
                    </div>
                    {flag.description && <p className="mt-1 text-sm text-gray-400">{flag.description}</p>}
                    {flag.tenant_overrides.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {flag.tenant_overrides.map(o => (
                          <span key={o.company_id} className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                            o.enabled ? 'bg-emerald-900/50 text-emerald-200' : 'bg-red-900/50 text-red-200'
                          }`}>
                            <Building2 className="h-3 w-3" />
                            {o.company_name} {o.enabled ? '✓' : '✗'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Editar"
                      onClick={() => setEditing(flag)}
                      className="rounded p-2 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Excluir"
                      onClick={() => deleteFlag(flag.key)}
                      className="rounded p-2 text-gray-500 hover:bg-red-900/30 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {creating && (
        <CreateFlagModal
          onClose={() => setCreating(false)}
          onSaved={() => { load(); setCreating(false) }}
        />
      )}
      {editing && (
        <EditFlagModal
          flag={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => { load(); setEditing(null) }}
        />
      )}
    </div>
  )
}

function CreateFlagModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [strategy, setStrategy] = useState<Strategy>('OFF')
  const [rolloutPct, setRolloutPct] = useState(0)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!key.trim() || !/^[a-z0-9_.-]+$/i.test(key)) {
      toast.error('Chave inválida (letras, números, _, ., -)')
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/admin/feature-flags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: key.trim(),
          description: description.trim() || null,
          strategy,
          rollout_pct: rolloutPct,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error ?? 'Erro')
      }
      toast.success('Flag criada')
      onSaved()
    } catch (e: any) {
      toast.error(`Falha: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-gray-900 border border-gray-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
          <h2 className="text-lg font-semibold">Nova Flag</h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Chave * (snake_case)</label>
            <input
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="payment_reminders_v2"
              className="w-full rounded-md bg-gray-800 border border-gray-700 py-2 px-3 text-sm font-mono text-amber-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Descrição</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              placeholder="Para que serve esta flag..."
              className="w-full rounded-md bg-gray-800 border border-gray-700 py-2 px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Estratégia</label>
              <select
                aria-label="Estratégia"
                value={strategy}
                onChange={e => setStrategy(e.target.value as Strategy)}
                className="w-full rounded-md bg-gray-800 border border-gray-700 py-2 px-3 text-sm"
              >
                <option value="OFF">OFF (desligada)</option>
                <option value="ON">ON (todos)</option>
                <option value="PERCENTAGE">Rollout %</option>
                <option value="TENANT_LIST">Por tenant</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Rollout %</label>
              <input
                type="number"
                min={0}
                max={100}
                disabled={strategy !== 'PERCENTAGE'}
                value={rolloutPct}
                onChange={e => setRolloutPct(Number(e.target.value))}
                className="w-full rounded-md bg-gray-800 border border-gray-700 py-2 px-3 text-sm disabled:opacity-40"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-800 bg-gray-900/50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar
          </button>
        </div>
      </div>
    </div>
  )
}

function EditFlagModal({
  flag,
  companies,
  onClose,
  onSaved,
}: {
  flag: FeatureFlag
  companies: Company[]
  onClose: () => void
  onSaved: () => void
}) {
  const [description, setDescription] = useState(flag.description ?? '')
  const [strategy, setStrategy] = useState<Strategy>(flag.strategy)
  const [rolloutPct, setRolloutPct] = useState(flag.rollout_pct)
  const [overrides, setOverrides] = useState<TenantOverride[]>(flag.tenant_overrides)
  const [saving, setSaving] = useState(false)

  async function saveFlag() {
    setSaving(true)
    try {
      const r = await fetch(`/api/admin/feature-flags/${encodeURIComponent(flag.key)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description: description.trim() || null,
          strategy,
          rollout_pct: rolloutPct,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error ?? 'Erro')
      }
      toast.success('Flag atualizada')
      onSaved()
    } catch (e: any) {
      toast.error(`Falha: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function setOverride(companyId: string, enabled: boolean) {
    try {
      const r = await fetch(`/api/admin/feature-flags/${encodeURIComponent(flag.key)}/overrides`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, enabled }),
      })
      if (!r.ok) throw new Error()
      const company = companies.find(c => c.id === companyId)
      setOverrides(prev => {
        const idx = prev.findIndex(o => o.company_id === companyId)
        const newOv: TenantOverride = {
          company_id: companyId,
          company_name: company?.name ?? companyId,
          enabled,
          enabled_at: new Date().toISOString(),
        }
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = newOv
          return next
        }
        return [...prev, newOv]
      })
      toast.success('Override aplicado')
    } catch {
      toast.error('Falha ao aplicar override')
    }
  }

  async function removeOverride(companyId: string) {
    try {
      const r = await fetch(`/api/admin/feature-flags/${encodeURIComponent(flag.key)}/overrides`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      })
      if (!r.ok) throw new Error()
      setOverrides(prev => prev.filter(o => o.company_id !== companyId))
      toast.success('Override removido')
    } catch {
      toast.error('Falha ao remover')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-gray-900 border border-gray-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Editar <code className="text-amber-300 text-base">{flag.key}</code>
          </h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Descrição</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md bg-gray-800 border border-gray-700 py-2 px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Estratégia</label>
              <select
                aria-label="Estratégia"
                value={strategy}
                onChange={e => setStrategy(e.target.value as Strategy)}
                className="w-full rounded-md bg-gray-800 border border-gray-700 py-2 px-3 text-sm"
              >
                <option value="OFF">OFF (desligada)</option>
                <option value="ON">ON (todos)</option>
                <option value="PERCENTAGE">Rollout %</option>
                <option value="TENANT_LIST">Por tenant</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Rollout %</label>
              <input
                type="number"
                min={0}
                max={100}
                disabled={strategy !== 'PERCENTAGE'}
                value={rolloutPct}
                onChange={e => setRolloutPct(Number(e.target.value))}
                className="w-full rounded-md bg-gray-800 border border-gray-700 py-2 px-3 text-sm disabled:opacity-40"
              />
            </div>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <h3 className="text-sm font-semibold mb-2">Overrides por tenant</h3>
            <p className="text-xs text-gray-500 mb-3">Estratégia TENANT_LIST: rollout só em tenants explícitos. Outras estratégias: overrides forçam ON/OFF independente do default.</p>
            <div className="space-y-2">
              {companies.map(c => {
                const override = overrides.find(o => o.company_id === c.id)
                return (
                  <div key={c.id} className="flex items-center justify-between rounded border border-gray-800 bg-gray-800/50 p-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-gray-500" />
                      <div>
                        <div className="text-sm font-medium">{c.name}</div>
                        <code className="text-[10px] text-gray-500">{c.id}</code>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setOverride(c.id, true)}
                        className={`rounded px-3 py-1 text-xs font-medium ${
                          override?.enabled
                            ? 'bg-emerald-700 text-emerald-100'
                            : 'bg-gray-800 text-gray-500 hover:bg-emerald-900/30'
                        }`}
                      >
                        ON
                      </button>
                      <button
                        type="button"
                        onClick={() => setOverride(c.id, false)}
                        className={`rounded px-3 py-1 text-xs font-medium ${
                          override && !override.enabled
                            ? 'bg-red-700 text-red-100'
                            : 'bg-gray-800 text-gray-500 hover:bg-red-900/30'
                        }`}
                      >
                        OFF
                      </button>
                      {override && (
                        <button
                          type="button"
                          onClick={() => removeOverride(c.id)}
                          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-700"
                          title="Remover override (volta ao default da estratégia)"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {companies.length === 0 && (
                <p className="text-xs text-gray-500 italic">Nenhuma empresa cadastrada</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-800 bg-gray-900/50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={saveFlag}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar mudanças
          </button>
        </div>
      </div>
    </div>
  )
}
