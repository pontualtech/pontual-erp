'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Loader2, Phone, Mail, MessageCircle, ExternalLink, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * Aging Report A/R — Sprint UX-15 Onda 5 (2026-05-23) · Fase 3 visual refine 2026-05-31
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

// Cor por severidade do bucket. Anti-pattern: sem hover:scale (layout shift Stripe rule).
const BUCKET_TONE: Record<string, { border: string; bg: string; text: string; accent: string }> = {
  future:   { border: 'border-blue-200',   bg: 'bg-blue-50/60',   text: 'text-blue-700',   accent: 'bg-blue-500' },
  '0-30':   { border: 'border-amber-200',  bg: 'bg-amber-50/60',  text: 'text-amber-700',  accent: 'bg-amber-500' },
  '31-60':  { border: 'border-orange-200', bg: 'bg-orange-50/60', text: 'text-orange-700', accent: 'bg-orange-500' },
  '61-90':  { border: 'border-red-200',    bg: 'bg-red-50/60',    text: 'text-red-700',    accent: 'bg-red-500' },
  '90+':    { border: 'border-rose-300',   bg: 'bg-rose-100/60',  text: 'text-rose-800',   accent: 'bg-rose-600' },
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
    <div className="space-y-5">
      {/* Header consistente com /financeiro */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Financeiro</p>
          <h1 className="mt-0.5 text-2xl font-semibold text-gray-900">Aging A/R — Inadimplência</h1>
          <p className="mt-1 text-xs text-gray-500">Por faixa de atraso · padrão QuickBooks / SAP FBL5N</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/financeiro/contas-receber"
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100"
          >
            <TrendingUp className="h-4 w-4" />
            Contas a receber
          </Link>
          <Link
            href="/financeiro/contas-pagar"
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-100"
          >
            <TrendingDown className="h-4 w-4" />
            Contas a pagar
          </Link>
        </div>
      </div>

      {/* Filtros sticky */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-gray-200 bg-white/85 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="aging-min" className="mb-1 block text-[11px] text-gray-500">Valor mínimo (R$)</label>
            <input
              id="aging-min"
              type="text"
              value={minValueR}
              onChange={(e) => setMinValueR(e.target.value)}
              onBlur={() => load()}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="0"
              className="h-9 w-28 rounded-md border border-gray-200 bg-white px-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Atualizar
          </button>
          {data?.generated_at && (
            <span className="ml-auto text-[11px] text-gray-400 tabular-nums">
              Atualizado: {new Date(data.generated_at).toLocaleString('pt-BR')}
            </span>
          )}
        </div>
      </div>

      {loading && !data ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">
          <Loader2 className="mr-2 inline h-5 w-5 animate-spin" /> Carregando…
        </div>
      ) : !data ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">Sem dados</div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Total a receber</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">{fmt(data.summary.grand_total)}</p>
              <p className="mt-1 text-xs text-gray-500 tabular-nums">{data.summary.overdue_count + data.summary.future_count} título(s)</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
              <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-amber-700">
                <AlertTriangle className="h-3 w-3" /> Vencidos
              </p>
              <p className="mt-1 text-2xl font-semibold text-amber-900 tabular-nums">{fmt(data.summary.total_overdue)}</p>
              <p className="mt-1 text-xs text-amber-700 tabular-nums">{data.summary.overdue_count} título(s) inadimplente(s)</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">A vencer</p>
              <p className="mt-1 text-2xl font-semibold text-blue-700 tabular-nums">{fmt(data.summary.total_future)}</p>
              <p className="mt-1 text-xs text-gray-500 tabular-nums">{data.summary.future_count} título(s)</p>
            </div>
          </div>

          {/* Buckets */}
          <div>
            <h2 className="mb-3 text-base font-semibold text-gray-900">Por faixa de atraso</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {data.buckets.map((b) => {
                const tone = BUCKET_TONE[b.key]
                const isExpanded = expandedBucket === b.key
                const disabled = b.count === 0
                const totalAll = data.summary.grand_total || 1
                const pct = (b.total / totalAll) * 100
                return (
                  <button
                    type="button"
                    key={b.key}
                    onClick={() => setExpandedBucket(isExpanded ? null : b.key)}
                    disabled={disabled}
                    className={cn(
                      'relative overflow-hidden rounded-xl border bg-white p-4 text-left transition-all',
                      tone.border,
                      isExpanded && `ring-2 ring-offset-2 ${tone.text.replace('text-', 'ring-')}`,
                      disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:-translate-y-px hover:shadow-md',
                    )}
                  >
                    <p className={cn('text-[11px] font-semibold uppercase tracking-wider', tone.text)}>{b.label}</p>
                    <p className="mt-1 text-xl font-semibold text-gray-900 tabular-nums">{fmt(b.total)}</p>
                    <p className="mt-1 text-xs text-gray-500 tabular-nums">{b.count} título(s)</p>
                    {/* Bar % do total */}
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className={cn('h-full rounded-full transition-all duration-500', tone.accent)} style={{ width: `${Math.max(pct, b.total === 0 ? 0 : 4)}%` }} />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Expanded Bucket */}
          {expandedBucket && (() => {
            const b = data.buckets.find((x) => x.key === expandedBucket)
            if (!b || b.receivables.length === 0) return null
            return (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 bg-gray-50/50">
                  <h3 className="text-sm font-semibold text-gray-900">{b.label} — {b.count} título(s)</h3>
                  <button
                    type="button"
                    onClick={() => setExpandedBucket(null)}
                    className="text-xs font-medium text-gray-500 hover:text-gray-700"
                  >
                    Fechar
                  </button>
                </div>
                <div className="divide-y divide-gray-100">
                  {b.receivables.map((r) => {
                    const wa = waLink(r.customer_phone, r.customer_name, r.remaining)
                    return (
                      <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/financeiro/contas-receber/${r.id}`}
                            className="inline-flex items-center gap-1 font-medium text-gray-900 hover:text-blue-600"
                          >
                            <span className="truncate">{r.description}</span>
                            <ExternalLink className="h-3 w-3 flex-none" />
                          </Link>
                          <p className="truncate text-xs text-gray-500">{r.customer_name}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-gray-900 tabular-nums">{fmt(r.remaining)}</p>
                          <p className="text-xs text-gray-500 tabular-nums">venc: {new Date(r.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                        </div>
                        {r.days_overdue > 0 && (
                          <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-100 tabular-nums">
                            {r.days_overdue}d
                          </span>
                        )}
                        <div className="flex items-center gap-1">
                          {wa && (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded p-1.5 text-emerald-600 transition-colors hover:bg-emerald-50"
                              title="Enviar WhatsApp"
                            >
                              <MessageCircle className="h-4 w-4" />
                            </a>
                          )}
                          {r.customer_phone && (
                            <a
                              href={`tel:${r.customer_phone}`}
                              className="rounded p-1.5 text-blue-600 transition-colors hover:bg-blue-50"
                              title="Ligar"
                            >
                              <Phone className="h-4 w-4" />
                            </a>
                          )}
                          {r.customer_email && (
                            <a
                              href={`mailto:${r.customer_email}?subject=${encodeURIComponent('Cobrança em aberto')}&body=${encodeURIComponent(`Cobrança em aberto: ${r.description} - ${fmt(r.remaining)}`)}`}
                              className="rounded p-1.5 text-purple-600 transition-colors hover:bg-purple-50"
                              title="Email"
                            >
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
              <h2 className="mb-3 text-base font-semibold text-gray-900">Top 10 inadimplentes</h2>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
                <div className="divide-y divide-gray-100">
                  {data.top_inadimplentes.map((c, i) => {
                    const wa = waLink(c.customer_phone, c.customer_name, c.total)
                    return (
                      <div key={c.customer_id || `nocust-${i}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50">
                        <span className="w-6 text-right text-sm font-semibold tabular-nums text-gray-400">#{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          {c.customer_id ? (
                            <Link href={`/clientes/${c.customer_id}`} className="block truncate font-medium text-gray-900 hover:text-blue-600">
                              {c.customer_name}
                            </Link>
                          ) : (
                            <span className="block truncate font-medium text-gray-900">{c.customer_name}</span>
                          )}
                          <p className="text-xs text-gray-500 tabular-nums">{c.count} título(s) · pior atraso: {c.worst_days}d</p>
                        </div>
                        <p className="text-sm font-semibold text-red-700 tabular-nums">{fmt(c.total)}</p>
                        {wa && (
                          <a
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded p-1.5 text-emerald-600 transition-colors hover:bg-emerald-50"
                            title="WhatsApp"
                          >
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
