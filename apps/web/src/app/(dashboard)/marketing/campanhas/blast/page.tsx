'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Send, X, AlertCircle, RefreshCw, Mail } from 'lucide-react'

interface Campaign {
  id: string
  slug: string
  template_name: string
  subject: string
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'
  total_jobs: number
  sent_count: number
  failed_count: number
  skipped_count: number
  rate_limit_per_sec: number
  started_at: string | null
  finished_at: string | null
  created_at: string
}

interface CampaignDetail {
  campaign: Campaign
  stats: { pending: number; queued: number; sent: number; failed: number; skipped: number }
  progress_pct: number
  recent_failed: Array<{ email: string; attempts: number; error: string | null; failed_at: string | null }>
}

const STATUS_COLORS: Record<Campaign['status'], string> = {
  queued: 'bg-slate-100 text-slate-700 border-slate-200',
  running: 'bg-blue-100 text-blue-700 border-blue-200',
  completed: 'bg-green-100 text-green-700 border-green-200',
  cancelled: 'bg-amber-100 text-amber-700 border-amber-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
}

export default function BlastPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [queueAvailable, setQueueAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const fetchCampaigns = useCallback(async () => {
    try {
      const r = await fetch('/api/marketing/blast?limit=100')
      const data = await r.json()
      setCampaigns(data.data?.campaigns || [])
      setQueueAvailable(data.data?.queue_available ?? true)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/marketing/blast/${id}`)
      const data = await r.json()
      setDetail(data.data || null)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    fetchCampaigns()
  }, [fetchCampaigns])

  // Auto-refresh enquanto tiver campanha running
  useEffect(() => {
    const hasRunning = campaigns.some(c => c.status === 'running' || c.status === 'queued')
    if (!hasRunning && !selectedId) return
    const iv = setInterval(() => {
      fetchCampaigns()
      if (selectedId) fetchDetail(selectedId)
    }, 5000)
    return () => clearInterval(iv)
  }, [campaigns, selectedId, fetchCampaigns, fetchDetail])

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId)
    else setDetail(null)
  }, [selectedId, fetchDetail])

  async function cancelCampaign(id: string) {
    if (!confirm('Cancelar essa campanha? Jobs ainda não enviados não vão sair.')) return
    try {
      await fetch(`/api/marketing/blast/${id}`, { method: 'DELETE' })
      fetchCampaigns()
      if (selectedId === id) fetchDetail(id)
    } catch (e) {
      alert('Erro ao cancelar: ' + (e instanceof Error ? e.message : 'desconhecido'))
    }
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Send className="w-6 h-6 text-blue-600" />
            Campanhas de E-mail (Blast)
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Disparo controlado de e-mails marketing/newsletter com fila + retry automático.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchCampaigns}
            className="p-2 rounded-md border border-slate-200 hover:bg-slate-50"
            title="Atualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            disabled={!queueAvailable}
            className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Mail className="w-4 h-4" />
            Nova campanha
          </button>
        </div>
      </header>

      {!queueAvailable && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-900">
            <strong>Fila offline:</strong> REDIS_URL não configurado. Campanhas não podem ser disparadas. Contate o admin de infra.
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <Mail className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p>Nenhuma campanha ainda. Clique em "Nova campanha" pra começar.</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            {campaigns.map(c => {
              const pct = c.total_jobs > 0 ? Math.round((c.sent_count / c.total_jobs) * 100) : 0
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`bg-white border rounded-lg p-4 cursor-pointer transition hover:border-blue-300 ${
                    selectedId === c.id ? 'border-blue-500 shadow-sm' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{c.slug}</div>
                      <div className="text-xs text-slate-500 truncate mt-0.5">
                        {c.subject}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded border ${STATUS_COLORS[c.status]}`}>
                      {c.status}
                    </span>
                  </div>

                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                      <span>{c.sent_count} / {c.total_jobs} enviados</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {(c.status === 'running' || c.status === 'queued') && (
                    <button
                      onClick={(e) => { e.stopPropagation(); cancelCampaign(c.id) }}
                      className="mt-3 text-xs text-red-600 hover:underline flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Cancelar
                    </button>
                  )}

                  {c.failed_count > 0 && (
                    <div className="mt-2 text-xs text-red-600">
                      ⚠ {c.failed_count} falharam
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4 sticky top-4 h-fit">
            {detail ? (
              <>
                <h3 className="font-semibold text-lg mb-3">{detail.campaign.slug}</h3>
                <div className="space-y-1 text-sm">
                  <div><span className="text-slate-500">Template:</span> <code className="text-xs bg-slate-100 px-1 rounded">{detail.campaign.template_name}</code></div>
                  <div><span className="text-slate-500">Assunto:</span> {detail.campaign.subject}</div>
                  <div><span className="text-slate-500">Rate:</span> {detail.campaign.rate_limit_per_sec}/seg</div>
                </div>
                <div className="grid grid-cols-5 gap-2 mt-4">
                  {(['pending', 'queued', 'sent', 'failed', 'skipped'] as const).map(s => (
                    <div key={s} className="text-center">
                      <div className="text-xs text-slate-500 uppercase">{s}</div>
                      <div className="font-semibold">{detail.stats[s]}</div>
                    </div>
                  ))}
                </div>
                {detail.recent_failed.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-semibold text-red-600 mb-2">Últimos erros</div>
                    <div className="space-y-1 text-xs">
                      {detail.recent_failed.slice(0, 5).map((f, i) => (
                        <div key={i} className="bg-red-50 px-2 py-1 rounded">
                          <div className="font-mono">{f.email}</div>
                          <div className="text-red-700">{f.error}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center text-slate-400 py-8">
                Clique em uma campanha pra ver detalhes
              </div>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchCampaigns() }} />
      )}
    </div>
  )
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    slug: '',
    template_name: 'email3_notebook_empresarial.html',
    subject: '',
    rate_limit_per_sec: 1.0,
    contact_tags: '',
    dry_run: false,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null); setSubmitting(true)
    try {
      const body: any = {
        slug: form.slug.trim(),
        template_name: form.template_name.trim(),
        subject: form.subject.trim(),
        rate_limit_per_sec: form.rate_limit_per_sec,
        dry_run: form.dry_run,
      }
      const tags = form.contact_tags.split(',').map(t => t.trim()).filter(Boolean)
      if (tags.length > 0) body.contact_tags = tags

      const r = await fetch('/api/marketing/blast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok) {
        setError(data.error || data.detail || 'erro')
      } else {
        onCreated()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Nova campanha de blast</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-600">Slug único *</label>
            <input
              value={form.slug}
              onChange={e => setForm({ ...form, slug: e.target.value })}
              placeholder="email3_b2b_conserto_2026_05_29"
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Template HTML *</label>
            <input
              value={form.template_name}
              onChange={e => setForm({ ...form, template_name: e.target.value })}
              placeholder="email3_notebook_empresarial.html"
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Assunto *</label>
            <input
              value={form.subject}
              onChange={e => setForm({ ...form, subject: e.target.value })}
              placeholder="Impressora ou notebook quebrou?"
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Taxa (jobs/seg)</label>
              <input
                type="number" step="0.5" min="0.1" max="10"
                value={form.rate_limit_per_sec}
                onChange={e => setForm({ ...form, rate_limit_per_sec: parseFloat(e.target.value) })}
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.dry_run}
                  onChange={e => setForm({ ...form, dry_run: e.target.checked })}
                />
                Dry-run (não dispara)
              </label>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Tags de contato (vírgula)</label>
            <input
              value={form.contact_tags}
              onChange={e => setForm({ ...form, contact_tags: e.target.value })}
              placeholder="b2b, cold, engaged (vazio = TODOS não-unsubscribed)"
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded text-sm"
            />
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-200 rounded hover:bg-slate-50">Cancelar</button>
          <button
            onClick={submit}
            disabled={submitting || !form.slug || !form.template_name || !form.subject}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {form.dry_run ? 'Criar dry-run' : 'Disparar campanha'}
          </button>
        </div>
      </div>
    </div>
  )
}
