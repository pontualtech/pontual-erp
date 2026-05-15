'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Send, Eye, Loader2, AlertTriangle, CheckCircle2,
  Megaphone, Users, FileText, Code,
} from 'lucide-react'

interface Segment {
  id: string
  name: string
  description: string | null
  contact_count: number | null
}

interface DryRunResult {
  total: number
  sample: { email: string; name: string | null }[]
  segmentName: string
  campaignTag: string
}

interface SendResult {
  sent: number
  failed: number
  total: number
  durationMs: number
  campaignTag: string
  segmentName: string
  failedDetails: { email: string; error: string }[]
}

const HARD_LIMIT = 500

function slugify(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

const DEFAULT_HTML = `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:24px auto;padding:24px;color:#0f172a">
  <h2 style="color:#7c3aed">Olá!</h2>
  <p>Mensagem do seu time PontualTech.</p>
  <p>Atenciosamente,<br>Equipe PontualTech</p>
</body></html>`

export default function EnviarCampanhaPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [segment, setSegment] = useState<Segment | null>(null)
  const [loading, setLoading] = useState(true)

  // Form state
  const [subject, setSubject] = useState('')
  const [html, setHtml] = useState(DEFAULT_HTML)
  const [campaignTag, setCampaignTag] = useState('')

  // UI state
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [result, setResult] = useState<SendResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const r = await fetch(`/api/marketing/segmentos/${params.id}`)
        if (r.ok) {
          const seg: Segment = (await r.json()).data?.segment
          setSegment(seg)
          // Auto-gera tag campaign
          const today = new Date()
          const yyyymmdd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
          setCampaignTag(`${slugify(seg.name)}_${yyyymmdd}`)
        }
      } finally {
        setLoading(false)
      }
    }
    if (params.id) load()
  }, [params.id])

  const previewSrcDoc = useMemo(() => html, [html])

  const canDryRun = subject.trim().length > 0 && html.trim().length > 0 && /^[a-z0-9_]{3,60}$/.test(campaignTag)
  const canSend = canDryRun && dryRun && dryRun.total > 0 && dryRun.total <= HARD_LIMIT

  async function handleDryRun() {
    setErr(null); setDryRun(null); setDryRunLoading(true)
    try {
      const r = await fetch('/api/marketing/campanhas/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ segmentId: params.id, subject, html, campaignTag, dryRun: true }),
      })
      const body = await r.json()
      if (!r.ok) {
        setErr(body.error || `HTTP ${r.status}`)
      } else {
        setDryRun(body.data)
      }
    } catch (e: any) {
      setErr(e.message || 'Erro de rede')
    } finally {
      setDryRunLoading(false)
    }
  }

  async function handleSend() {
    setErr(null); setSending(true); setShowConfirm(false)
    try {
      const r = await fetch('/api/marketing/campanhas/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ segmentId: params.id, subject, html, campaignTag, dryRun: false }),
      })
      const body = await r.json()
      if (!r.ok) {
        setErr(body.error || `HTTP ${r.status}`)
      } else {
        setResult(body.data)
      }
    } catch (e: any) {
      setErr(e.message || 'Erro de rede')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
  if (!segment) return <div className="p-6 text-center text-gray-500">Segmento não encontrado.</div>

  // Tela pós-envio
  if (result) {
    return (
      <div className="mx-auto max-w-3xl p-6 lg:p-8">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <CheckCircle2 className="mx-auto h-16 w-16 text-green-500" />
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Campanha enviada
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            <strong className="font-mono text-gray-900 dark:text-gray-100">{result.campaignTag}</strong> · segmento <strong>{result.segmentName}</strong>
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-green-50 p-3 dark:bg-green-500/10">
              <div className="text-2xl font-bold text-green-700 dark:text-green-400 tabular-nums">{result.sent}</div>
              <div className="text-xs text-green-700 dark:text-green-400">enviados</div>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-500/10">
              <div className="text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{result.failed}</div>
              <div className="text-xs text-amber-700 dark:text-amber-400">falhas</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
              <div className="text-2xl font-bold text-gray-700 dark:text-gray-300 tabular-nums">{(result.durationMs / 1000).toFixed(1)}s</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">duração</div>
            </div>
          </div>
          {result.failedDetails.length > 0 && (
            <details className="mt-4 text-left text-xs">
              <summary className="cursor-pointer text-amber-700 dark:text-amber-400">Ver falhas ({result.failedDetails.length})</summary>
              <ul className="mt-2 space-y-1 rounded bg-amber-50 p-2 dark:bg-amber-500/10">
                {result.failedDetails.map((f, i) => (
                  <li key={i} className="font-mono">{f.email} → {f.error}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-6 flex justify-center gap-2">
            <Link href={`/marketing/campanhas`} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              Ver métricas em Campanhas
            </Link>
            <Link href={`/marketing/segmentos/${params.id}`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
              Voltar pro segmento
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      {/* Header */}
      <Link href={`/marketing/segmentos/${params.id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Voltar pro segmento
      </Link>
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 p-2.5 text-white shadow-sm">
          <Megaphone className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Enviar campanha
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Segmento: <strong>{segment.name}</strong>
            {typeof segment.contact_count === 'number' && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs"><Users className="h-3 w-3" /> {segment.contact_count.toLocaleString('pt-BR')} contatos</span>
            )}
          </p>
        </div>
      </div>

      {/* Limite hard warning */}
      {segment.contact_count !== null && segment.contact_count > HARD_LIMIT && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-500/10 dark:text-amber-300">
          <strong>Limite por envio: {HARD_LIMIT} contatos.</strong> Este segmento tem {segment.contact_count.toLocaleString('pt-BR')}. Refine o filtro ou aguarde feature de batching. O envio agora vai ser bloqueado.
        </div>
      )}

      {/* Erro */}
      {err && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle className="mr-1 inline h-4 w-4" /> {err}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tag da campanha</label>
            <input
              type="text"
              value={campaignTag}
              onChange={e => setCampaignTag(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              className="mt-1 block w-full rounded-md border-gray-300 bg-white px-3 py-2 font-mono text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder="ex: cliente_atendido_20260515"
            />
            <p className="mt-1 text-xs text-gray-500">a-z 0-9 _ apenas (3-60 caracteres). Usado pra agrupar em /marketing/campanhas.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Assunto</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder="Ex: Sua impressora precisa de manutenção?"
              maxLength={200}
            />
            <p className="mt-1 text-xs text-gray-500">{subject.length}/200</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              <Code className="mr-1 inline h-3 w-3" /> Corpo (HTML)
            </label>
            <textarea
              value={html}
              onChange={e => setHtml(e.target.value)}
              rows={16}
              className="mt-1 block w-full rounded-md border-gray-300 bg-white px-3 py-2 font-mono text-xs shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              maxLength={50000}
            />
            <p className="mt-1 text-xs text-gray-500">{html.length.toLocaleString('pt-BR')}/50.000</p>
          </div>
        </div>

        {/* Preview */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            <Eye className="h-4 w-4" /> Pré-visualização
          </div>
          <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-600">
            <iframe
              srcDoc={previewSrcDoc}
              sandbox=""
              title="Preview"
              className="h-[600px] w-full bg-white"
            />
          </div>
        </div>
      </div>

      {/* Dry-run result */}
      {dryRun && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-500/10">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <strong className="text-blue-900 dark:text-blue-100">{dryRun.total} contatos</strong> serão alcançados ({dryRun.total > HARD_LIMIT ? 'ACIMA do limite, bloqueado' : `dentro do limite ${HARD_LIMIT}`}).
            </div>
            <Eye className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-2 text-xs text-blue-700 dark:text-blue-300">
            Primeiros 5: {dryRun.sample.map(s => s.email).join(' · ') || '(vazio)'}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        <button
          type="button"
          onClick={handleDryRun}
          disabled={!canDryRun || dryRunLoading}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {dryRunLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          Pré-visualizar (dry-run)
        </button>
        <button
          type="button"
          onClick={() => { setConfirmText(''); setShowConfirm(true) }}
          disabled={!canSend || sending}
          className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar agora
        </button>
      </div>

      {/* Confirmação dupla */}
      {showConfirm && dryRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <div className="mb-4 flex items-start gap-3">
              <div className="rounded-full bg-red-100 p-2 dark:bg-red-500/20">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Confirmar envio</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Você vai enviar <strong>{dryRun.total} emails</strong> agora. Não tem desfazer.
                </p>
              </div>
            </div>
            <div className="rounded bg-gray-50 p-3 text-xs dark:bg-gray-700/50">
              <div><strong>Segmento:</strong> {dryRun.segmentName}</div>
              <div><strong>Assunto:</strong> {subject}</div>
              <div><strong>Tag:</strong> <code className="font-mono">{campaignTag}</code></div>
            </div>
            <p className="mt-4 text-sm text-gray-700 dark:text-gray-300">
              Digite <strong className="font-mono text-red-600 dark:text-red-400">ENVIAR</strong> pra confirmar:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              autoFocus
              className="mt-1 block w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={confirmText !== 'ENVIAR'}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Confirmar envio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
