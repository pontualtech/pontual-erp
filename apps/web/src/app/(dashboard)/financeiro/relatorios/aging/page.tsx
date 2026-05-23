'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2, Phone, Mail, MessageCircle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Aging Report A/R — Sprint UX-15 Onda 5 (2026-05-23)
 *
 * Inspirado em QuickBooks A/R Aging Summary e SAP FBL5N.
 * Lista inadimplência por faixa etária + Top 10 clientes inadimplentes.
 *
 * Karlão usa pra decidir:
 *  - Ligar pra clientes 60+ dias?
 *  - Cortar crédito pra recorrentes inadimplentes?
 *  - Protestar 90+ dias?
 */

interface ReceivableItem {
  id: string
  os_id: string | null
  description: string
  customer_id: string | null
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  total_amount: number
  received_amount: number
  remaining: number
  due_date: string
  days_overdue: number
  charge_status: string | null
}

interface Bucket {
  label: string
  key: 'future' | '0-30' | '31-60' | '61-90' | '90+'
  total: number
  count: number
  receivables: ReceivableItem[]
}

interface AgingData {
  buckets: Bucket[]
  summary: {
    total_future: number
    total_overdue: number
    grand_total: number
    overdue_count: number
    future_count: number
  }
  top_inadimplentes: Array<{
    customer_id: string | null
    customer_name: string
    customer_phone: string | null
    total: number
    count: number
    worst_days: number
  }>
  generated_at: string
}

function fmt(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const BUCKET_COLORS: Record<string, string> = {
  future: 'bg-blue-50 border-blue-200 text-blue-700',
  '0-30': 'bg-amber-50 border-amber-200 text-amber-700',
  '31-60': 'bg-orange-50 border-orange-200 text-orange-700',
  '61-90': 'bg-red-50 border-red-200 text-red-700',
  '90+': 'bg-rose-100 border-rose-300 text-rose-800',
}

export default function AgingReportPage() {
  const [data, setData] = useState<AgingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null)
  const [minValueR, setMinValueR] = useState('0')

  async function load() {
    setLoading(true)
    try {
      const minCents = Math.round(parseFloat(minValueR.replace(',', '.')) * 100) || 0
      const res = await fetch(`/api/financeiro/relatorios/aging?min_value=${minCents}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Erro ao carregar')
      const j = await res.json()
      setData(j.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function waLink(phone: string | null, customerName: string, remaining: number) {
    if (!phone) return null
    const digits = phone.replace(/\D/g, '')
    const msg = encodeURIComponent(`Olá ${customerName.split(' ')[0]}, temos uma cobrança em aberto de ${fmt(remaining)}. Posso ajudar a regularizar?`)
    return `https://wa.me/55${digits}?text=${msg}`
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4">
      <div className="flex items-center gap-3">
        <Link href="/financeiro" className="rounded-xl border border-gray-200 dark:border-gray-700 p-2.5 hover:bg-gray-50 dark:hover:bg-gray-800">
          <ArrowLeft className="h-4 w-4 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Aging Report — A/R</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Inadimplência por faixa etária (similar QuickBooks A/R Aging Summary)</p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm text-gray-600 dark:text-gray-400">Valor mínimo (R$):</label>
        <input
          type="text"
          value={minValueR}
          onChange={e => setMinValueR(e.target.value)}
          onBlur={() => load()}
          onKeyDown={e => e.key === 'Enter' && load()}
          placeholder="0"
          className="w-24 px-3 py-1.5 border rounded-lg text-sm bg-white dark:bg-gray-800 dark:border-gray-700"
        />
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Atualizar'}
        </button>
        {data?.generated_at && (
          <span className="text-xs text-gray-400 ml-auto">
            Atualizado: {new Date(data.generated_at).toLocaleString('pt-BR')}
          </span>
        )}
      </div>

      {loading && !data ? (
        <div className="text-center py-20 text-gray-500"><Loader2 className="h-8 w-8 animate-spin inline mr-2" /> Carregando…</div>
      ) : !data ? (
        <div className="text-center py-20 text-gray-500">Sem dados</div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border bg-white dark:bg-gray-900 p-5 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total a receber</p>
              <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{fmt(data.summary.grand_total)}</p>
              <p className="mt-1 text-xs text-gray-400">{data.summary.overdue_count + data.summary.future_count} titulo(s)</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-5 shadow-sm">
              <p className="text-xs text-amber-700 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Vencidos
              </p>
              <p className="mt-1 text-2xl font-bold text-amber-800 dark:text-amber-200">{fmt(data.summary.total_overdue)}</p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{data.summary.overdue_count} titulo(s) inadimplente(s)</p>
            </div>
            <div className="rounded-xl border bg-white dark:bg-gray-900 p-5 shadow-sm">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">A vencer</p>
              <p className="mt-1 text-2xl font-bold text-blue-700">{fmt(data.summary.total_future)}</p>
              <p className="mt-1 text-xs text-gray-400">{data.summary.future_count} titulo(s)</p>
            </div>
          </div>

          {/* Buckets */}
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Por faixa de atraso</h2>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {data.buckets.map(b => (
                <button
                  type="button"
                  key={b.key}
                  onClick={() => setExpandedBucket(expandedBucket === b.key ? null : b.key)}
                  disabled={b.count === 0}
                  className={`rounded-xl border-2 p-4 text-left transition-all ${BUCKET_COLORS[b.key]} ${
                    expandedBucket === b.key ? 'ring-2 ring-offset-2 ring-current' : ''
                  } ${b.count === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02] cursor-pointer'}`}
                >
                  <p className="text-xs font-semibold uppercase">{b.label}</p>
                  <p className="text-xl font-bold mt-1">{fmt(b.total)}</p>
                  <p className="text-xs mt-1 opacity-80">{b.count} titulo(s)</p>
                </button>
              ))}
            </div>
          </div>

          {/* Expanded Bucket */}
          {expandedBucket && (() => {
            const b = data.buckets.find(x => x.key === expandedBucket)
            if (!b || b.receivables.length === 0) return null
            return (
              <div className="rounded-xl border bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
                  <h3 className="font-bold text-gray-900 dark:text-white">{b.label} — {b.count} titulo(s)</h3>
                  <button onClick={() => setExpandedBucket(null)} className="text-xs text-gray-500 hover:text-gray-700">Fechar</button>
                </div>
                <div className="divide-y dark:divide-gray-800">
                  {b.receivables.map(r => {
                    const wa = waLink(r.customer_phone, r.customer_name, r.remaining)
                    return (
                      <div key={r.id} className="px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <Link href={`/financeiro/contas-receber/${r.id}`} className="font-medium text-gray-900 dark:text-white truncate hover:text-blue-600 inline-flex items-center gap-1">
                            {r.description} <ExternalLink className="h-3 w-3" />
                          </Link>
                          <p className="text-xs text-gray-500 truncate">{r.customer_name}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-gray-900 dark:text-white">{fmt(r.remaining)}</p>
                          <p className="text-xs text-gray-500">venc: {new Date(r.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                        </div>
                        {r.days_overdue > 0 && (
                          <span className="text-xs font-semibold px-2 py-1 rounded bg-red-100 text-red-700">
                            {r.days_overdue}d
                          </span>
                        )}
                        <div className="flex items-center gap-1">
                          {wa && (
                            <a href={wa} target="_blank" rel="noopener noreferrer"
                              className="p-1.5 rounded hover:bg-green-100 text-green-600" title="Enviar WhatsApp">
                              <MessageCircle className="h-4 w-4" />
                            </a>
                          )}
                          {r.customer_phone && (
                            <a href={`tel:${r.customer_phone}`}
                              className="p-1.5 rounded hover:bg-blue-100 text-blue-600" title="Ligar">
                              <Phone className="h-4 w-4" />
                            </a>
                          )}
                          {r.customer_email && (
                            <a href={`mailto:${r.customer_email}?subject=Cobranca em aberto&body=${encodeURIComponent(`Cobranca em aberto: ${r.description} - ${fmt(r.remaining)}`)}`}
                              className="p-1.5 rounded hover:bg-purple-100 text-purple-600" title="Email">
                              <Mail className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Top inadimplentes */}
          {data.top_inadimplentes.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Top 10 inadimplentes</h2>
              <div className="rounded-xl border bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
                <div className="divide-y dark:divide-gray-800">
                  {data.top_inadimplentes.map((c, i) => {
                    const wa = waLink(c.customer_phone, c.customer_name, c.total)
                    return (
                      <div key={c.customer_id || `nocust-${i}`} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800">
                        <span className="w-6 text-right text-sm font-bold text-gray-400">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          {c.customer_id ? (
                            <Link href={`/clientes/${c.customer_id}`} className="font-medium text-gray-900 dark:text-white truncate hover:text-blue-600">
                              {c.customer_name}
                            </Link>
                          ) : (
                            <span className="font-medium text-gray-900 dark:text-white truncate">{c.customer_name}</span>
                          )}
                          <p className="text-xs text-gray-500">{c.count} titulo(s) · pior atraso: {c.worst_days}d</p>
                        </div>
                        <p className="text-sm font-bold text-red-700">{fmt(c.total)}</p>
                        {wa && (
                          <a href={wa} target="_blank" rel="noopener noreferrer"
                            className="p-1.5 rounded hover:bg-green-100 text-green-600" title="WhatsApp">
                            <MessageCircle className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
