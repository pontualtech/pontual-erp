'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Upload, CheckCircle2, AlertCircle, RefreshCw, Loader2, FileText, Users, ListChecks, Zap, BarChart3, Cloud, Settings2 } from 'lucide-react'

interface AcquirerTxn {
  id: string
  external_id: string
  transaction_date: string
  transaction_time?: string | null
  gross_amount: number
  net_amount: number
  mdr_fee_amount: number
  mdr_fee_percent?: number | null
  anticipation_fee_amount: number
  anticipation_fee_percent?: number | null
  total_fee_amount?: number | null
  modality?: string | null
  installments: number
  card_brand?: string | null
  card_last_4?: string | null
  card_masked?: string | null
  holder_name?: string | null
  authorization_code?: string | null
  expected_credit_date?: string | null
  terminal_code?: string | null
  acquirer?: string | null
  status: string
  match: {
    payment_id: string
    method: string
    os_number: number | null
    customer_name: string | null
    matched_at: string
  } | null
}

// Colunas disponiveis na listagem. `default` controla visibilidade
// inicial; usuario customiza via dropdown "Colunas" + persistencia localStorage.
const COLUMN_DEFS: Array<{ key: string; label: string; default: boolean }> = [
  { key: 'date', label: 'Data/Hora', default: true },
  { key: 'modality', label: 'Modalidade', default: true },
  { key: 'installments', label: 'Parcelas', default: false },
  { key: 'gross', label: 'Bruto', default: true },
  { key: 'net', label: 'Liquido', default: true },
  { key: 'mdr', label: 'MDR (taxa)', default: false },
  { key: 'mdr_pct', label: 'MDR %', default: false },
  { key: 'antecip', label: 'Antecipacao', default: false },
  { key: 'antecip_pct', label: 'Antecip. %', default: false },
  { key: 'total_fee', label: 'Total taxas', default: false },
  { key: 'card', label: 'Cartao', default: true },
  { key: 'holder', label: 'Pagador', default: true },
  { key: 'auth', label: 'Autorizacao', default: false },
  { key: 'nsu', label: 'NSU', default: false },
  { key: 'terminal', label: 'Maquininha', default: true },
  { key: 'credit_date', label: 'Credito previsto', default: true },
  { key: 'acquirer', label: 'Adquirente', default: false },
  { key: 'status', label: 'Status', default: false },
]

const COLUMNS_LS_KEY = 'maquininha_columns_v1'

interface OS {
  id: string
  os_number: number
  total_cost: number
  customer_name?: string
  status_name?: string
  transaction_date?: string
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function MaquininhaHubPage() {
  const [tab, setTab] = useState<'pendentes' | 'conciliadas'>('pendentes')
  const [txns, setTxns] = useState<AcquirerTxn[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [autoMatching, setAutoMatching] = useState(false)
  const [syncingRede, setSyncingRede] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [matchingTxn, setMatchingTxn] = useState<AcquirerTxn | null>(null)

  // Colunas visiveis — persiste em localStorage; SSR sempre renderiza defaults.
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>(
    () => Object.fromEntries(COLUMN_DEFS.map(c => [c.key, c.default]))
  )
  const [colsMenuOpen, setColsMenuOpen] = useState(false)
  const colsMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLUMNS_LS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          setVisibleCols(prev => ({ ...prev, ...parsed }))
        }
      }
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem(COLUMNS_LS_KEY, JSON.stringify(visibleCols)) } catch {}
  }, [visibleCols])

  // Fecha menu Colunas ao clicar fora.
  useEffect(() => {
    if (!colsMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (colsMenuRef.current && !colsMenuRef.current.contains(e.target as Node)) {
        setColsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [colsMenuOpen])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/financeiro/maquininha/transactions?matched=${tab === 'pendentes' ? 'no' : 'yes'}&limit=100`)
      const j = await res.json()
      setTxns(j.data?.data || [])
    } catch {
      toast.error('Erro ao carregar transacoes')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [tab])

  async function runSyncRede() {
    setSyncingRede(true)
    try {
      const res = await fetch('/api/financeiro/maquininha/sync-rede', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await res.json()
      if (!res.ok) {
        if (res.status === 503) {
          toast.warning(j.error || 'Configure REDE_CLIENT_ID/SECRET no Coolify primeiro', { duration: 6000 })
        } else {
          toast.error(j.error || 'Falha no sync')
        }
        return
      }
      const r = j.data
      toast.success(`Sync Rede: ${r.fetched} vendas (${r.inserted} novas, ${r.duplicates} ja existiam) — periodo ${r.period.from} a ${r.period.to}`)
      load()
    } catch {
      toast.error('Erro de rede')
    } finally { setSyncingRede(false) }
  }

  async function runAutoMatch() {
    setAutoMatching(true)
    try {
      const res = await fetch('/api/financeiro/maquininha/match-auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error || 'Falha no match auto'); return }
      const r = j.data
      if (r.auto_linked > 0) {
        toast.success(`${r.auto_linked} vinculadas automaticamente! ${r.suggestions} com sugestao manual.`)
      } else if (r.suggestions > 0) {
        toast.info(`${r.suggestions} candidatas encontradas — revisar manualmente. Nenhuma com confianca >= 95%.`)
      } else {
        toast.info(`Nenhum match automatico encontrado em ${r.processed} transacoes.`)
      }
      load()
    } catch {
      toast.error('Erro de rede')
    } finally { setAutoMatching(false) }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/financeiro/maquininha/import', {
        method: 'POST',
        body: fd,
      })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error || 'Falha ao importar'); return }
      const r = j.data
      toast.success(`Import OK — ${r.inserted} novas, ${r.duplicates} ja existiam, ${r.skipped} puladas`)
      load()
    } catch (err) {
      toast.error('Erro de rede no import')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="container mx-auto px-6 py-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Maquininha — Conciliação</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Importe extrato Rede e vincule vendas a OSes</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/financeiro/maquininha/relatorios"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800 text-sm font-semibold cursor-pointer">
            <BarChart3 className="h-4 w-4" /> Relatórios
          </Link>
          <Link href="/financeiro/maquininha/configurar"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800 text-sm font-semibold cursor-pointer">
            <Users className="h-4 w-4" /> Configurar
          </Link>
          <button type="button"
            onClick={runAutoMatch}
            disabled={autoMatching}
            title="Vincula automaticamente quando confianca >= 95%"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:border-blue-800 disabled:opacity-50 text-blue-800 dark:text-blue-300 text-sm font-bold cursor-pointer">
            {autoMatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {autoMatching ? 'Buscando...' : 'Match automático'}
          </button>
          <button type="button"
            onClick={runSyncRede}
            disabled={syncingRede}
            title="Puxa vendas direto da API Rede (requer credenciais configuradas)"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-orange-300 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/40 dark:border-orange-800 disabled:opacity-50 text-orange-800 dark:text-orange-300 text-sm font-bold cursor-pointer">
            {syncingRede ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            {syncingRede ? 'Sync...' : 'Sync API Rede'}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" hidden onChange={handleUpload} />
          <button type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold cursor-pointer">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? 'Enviando...' : 'Importar CSV Rede'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-zinc-800 mb-4">
        <nav className="flex gap-6">
          {[
            { k: 'pendentes', label: 'A conciliar', icon: AlertCircle },
            { k: 'conciliadas', label: 'Conciliadas', icon: CheckCircle2 },
          ].map(t => (
            <button key={t.k} type="button" onClick={() => setTab(t.k as any)}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 transition-colors text-sm font-semibold cursor-pointer ${
                tab === t.k
                  ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3 py-2">
            <div className="relative" ref={colsMenuRef}>
              <button type="button" onClick={() => setColsMenuOpen(o => !o)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800 text-xs font-semibold cursor-pointer"
                title="Mostrar/ocultar colunas da tabela">
                <Settings2 className="h-3.5 w-3.5" /> Colunas
              </button>
              {colsMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg z-30 py-1 max-h-80 overflow-y-auto">
                  {COLUMN_DEFS.map(c => (
                    <label key={c.key}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-zinc-800 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                      <input type="checkbox"
                        checked={!!visibleCols[c.key]}
                        onChange={e => setVisibleCols(v => ({ ...v, [c.key]: e.target.checked }))}
                        className="cursor-pointer" />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={load} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 cursor-pointer" title="Recarregar">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </nav>
      </div>

      {loading && txns.length === 0 ? (
        <div className="text-center py-16 text-gray-500"><Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />Carregando...</div>
      ) : txns.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          {tab === 'pendentes' ? 'Nenhuma transacao a conciliar — importe um CSV pra comecar' : 'Nenhuma transacao conciliada ainda'}
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 dark:bg-zinc-800/50 border-b border-gray-200 dark:border-zinc-700">
              <tr className="text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
                {visibleCols.date && <th className="px-4 py-3">Data/Hora</th>}
                {visibleCols.modality && <th className="px-4 py-3">Modalidade</th>}
                {visibleCols.installments && <th className="px-4 py-3 text-right">Parcelas</th>}
                {visibleCols.gross && <th className="px-4 py-3 text-right">Bruto</th>}
                {visibleCols.net && <th className="px-4 py-3 text-right">Liquido</th>}
                {visibleCols.mdr && <th className="px-4 py-3 text-right">MDR</th>}
                {visibleCols.mdr_pct && <th className="px-4 py-3 text-right">MDR %</th>}
                {visibleCols.antecip && <th className="px-4 py-3 text-right">Antecip.</th>}
                {visibleCols.antecip_pct && <th className="px-4 py-3 text-right">Antecip. %</th>}
                {visibleCols.total_fee && <th className="px-4 py-3 text-right">Total taxas</th>}
                {visibleCols.card && <th className="px-4 py-3">Cartao</th>}
                {visibleCols.holder && <th className="px-4 py-3">Pagador</th>}
                {visibleCols.auth && <th className="px-4 py-3">Autorizacao</th>}
                {visibleCols.nsu && <th className="px-4 py-3">NSU</th>}
                {visibleCols.terminal && <th className="px-4 py-3">Maquininha</th>}
                {visibleCols.credit_date && <th className="px-4 py-3">Credito prev.</th>}
                {visibleCols.acquirer && <th className="px-4 py-3">Adquirente</th>}
                {visibleCols.status && <th className="px-4 py-3">Status</th>}
                {tab === 'conciliadas' && <th className="px-4 py-3">OS / Cliente</th>}
                <th className="px-4 py-3 text-right">Acao</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {txns.map(t => (
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40">
                  {visibleCols.date && (
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                      <div>{new Date(t.transaction_date).toLocaleDateString('pt-BR')}</div>
                      <div className="text-xs text-gray-500">{t.transaction_time || ''}</div>
                    </td>
                  )}
                  {visibleCols.modality && (
                    <td className="px-4 py-3">
                      <span className="text-gray-900 dark:text-gray-100">
                        {t.modality === 'debit' ? 'Debito' : `Credito ${t.installments}x`}
                      </span>
                    </td>
                  )}
                  {visibleCols.installments && <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{t.installments}x</td>}
                  {visibleCols.gross && <td className="px-4 py-3 text-right font-mono text-gray-900 dark:text-gray-100">{fmt(t.gross_amount)}</td>}
                  {visibleCols.net && <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">{fmt(t.net_amount)}</td>}
                  {visibleCols.mdr && <td className="px-4 py-3 text-right font-mono text-xs text-gray-600 dark:text-gray-400">{fmt(t.mdr_fee_amount || 0)}</td>}
                  {visibleCols.mdr_pct && <td className="px-4 py-3 text-right font-mono text-xs text-gray-600 dark:text-gray-400">{t.mdr_fee_percent != null ? `${t.mdr_fee_percent.toFixed(2)}%` : '—'}</td>}
                  {visibleCols.antecip && <td className="px-4 py-3 text-right font-mono text-xs text-gray-600 dark:text-gray-400">{fmt(t.anticipation_fee_amount || 0)}</td>}
                  {visibleCols.antecip_pct && <td className="px-4 py-3 text-right font-mono text-xs text-gray-600 dark:text-gray-400">{t.anticipation_fee_percent != null ? `${t.anticipation_fee_percent.toFixed(2)}%` : '—'}</td>}
                  {visibleCols.total_fee && <td className="px-4 py-3 text-right font-mono text-xs text-gray-600 dark:text-gray-400">{fmt(t.total_fee_amount || 0)}</td>}
                  {visibleCols.card && (
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                      {t.card_masked || `${t.card_brand?.toUpperCase() || ''} ****${t.card_last_4 || '----'}`}
                    </td>
                  )}
                  {visibleCols.holder && <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">{t.holder_name || '—'}</td>}
                  {visibleCols.auth && <td className="px-4 py-3 text-xs font-mono text-gray-600 dark:text-gray-400">{t.authorization_code || '—'}</td>}
                  {visibleCols.nsu && <td className="px-4 py-3 text-xs font-mono text-gray-600 dark:text-gray-400">{t.external_id || '—'}</td>}
                  {visibleCols.terminal && <td className="px-4 py-3 text-xs font-mono text-gray-600 dark:text-gray-400">{t.terminal_code || '—'}</td>}
                  {visibleCols.credit_date && <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">{t.expected_credit_date ? new Date(t.expected_credit_date).toLocaleDateString('pt-BR') : '—'}</td>}
                  {visibleCols.acquirer && <td className="px-4 py-3 text-xs uppercase text-gray-600 dark:text-gray-400">{t.acquirer || '—'}</td>}
                  {visibleCols.status && <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">{t.status}</td>}
                  {tab === 'conciliadas' && (
                    <td className="px-4 py-3 text-xs">
                      {t.match ? (
                        <div>
                          <div className="font-semibold text-emerald-700 dark:text-emerald-400">OS-{String(t.match.os_number).padStart(4, '0')}</div>
                          <div className="text-gray-500">{t.match.customer_name}</div>
                        </div>
                      ) : '—'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    {tab === 'pendentes' && !t.match ? (
                      <button type="button" onClick={() => setMatchingTxn(t)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer">
                        <ListChecks className="h-3.5 w-3.5" /> Vincular OS
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">{t.match?.method || ''}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {matchingTxn && (
        <MatchModal
          txn={matchingTxn}
          onClose={() => setMatchingTxn(null)}
          onMatched={() => { setMatchingTxn(null); load() }}
        />
      )}
    </div>
  )
}

function MatchModal({ txn, onClose, onMatched }: { txn: AcquirerTxn; onClose: () => void; onMatched: () => void }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<OS[]>([])
  const [searching, setSearching] = useState(false)
  const [matching, setMatching] = useState(false)

  // Auto-busca: OSes com mesmo valor + janela de data (-15/+3 dias).
  // Janela assimetrica pra cobrir parcelamento — cliente paga semanas
  // depois da OS (1a parcela tipica ate 15-30 dias depois).
  useEffect(() => {
    const startDate = new Date(txn.transaction_date)
    startDate.setDate(startDate.getDate() - 15)
    const endDate = new Date(txn.transaction_date)
    endDate.setDate(endDate.getDate() + 3)
    setSearching(true)
    fetch(`/api/os?total_cost=${txn.gross_amount}&from=${startDate.toISOString().split('T')[0]}&to=${endDate.toISOString().split('T')[0]}&limit=20`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(j => setResults(j.data || []))
      .catch(() => {})
      .finally(() => setSearching(false))
  }, [txn.id])

  async function searchOS() {
    if (!search.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`/api/os?search=${encodeURIComponent(search)}&limit=20`)
      const j = await res.json()
      setResults(j.data || [])
    } finally { setSearching(false) }
  }

  async function vincular(osId: string) {
    setMatching(true)
    try {
      const res = await fetch('/api/financeiro/maquininha/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: txn.id, service_order_id: osId }),
      })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error || 'Falha no vinculo'); return }
      toast.success(`Vinculado a OS-${String(j.data.os_number).padStart(4, '0')}`)
      onMatched()
    } catch {
      toast.error('Erro de rede')
    } finally { setMatching(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 dark:border-zinc-800">
          <h3 className="font-bold text-gray-900 dark:text-gray-100">Vincular transacao a uma OS</h3>
          <p className="text-xs text-gray-500 mt-1">
            {new Date(txn.transaction_date).toLocaleDateString('pt-BR')} {txn.transaction_time} —{' '}
            {txn.modality === 'debit' ? 'Debito' : `Credito ${txn.installments}x`} —{' '}
            <strong>{fmt(txn.gross_amount)}</strong> — terminal {txn.terminal_code || '?'}
          </p>
        </div>

        <div className="px-5 py-3 border-b border-gray-100 dark:border-zinc-800">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Buscar OS por numero, cliente ou equipamento..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') searchOS() }}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
            />
            <button type="button" onClick={searchOS} disabled={searching}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buscar'}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">Auto-listadas: OSes com valor exato entre 15 dias antes e 3 dias depois da venda (cobre parcelamento).</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {searching && results.length === 0 ? (
            <p className="text-center text-gray-500 py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></p>
          ) : results.length === 0 ? (
            <p className="text-center text-gray-500 py-8">Nenhuma OS encontrada com esse valor + data. Use a busca acima.</p>
          ) : (
            results.map((os: any) => (
              <button key={os.id} type="button" onClick={() => vincular(os.id)} disabled={matching}
                className="w-full text-left p-3 rounded-lg border-2 border-gray-200 dark:border-zinc-700 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-all disabled:opacity-50 cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-gray-900 dark:text-gray-100">OS-{String(os.os_number).padStart(4, '0')}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{os.customers?.legal_name || os.customer_name}</div>
                    <div className="text-xs text-gray-500">{os.equipment_type} {os.equipment_brand} {os.equipment_model}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-gray-900 dark:text-gray-100">{fmt(os.total_cost || 0)}</div>
                    <div className="text-xs text-gray-500">{new Date(os.created_at).toLocaleDateString('pt-BR')}</div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-zinc-800 flex justify-end">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-gray-300 text-sm cursor-pointer">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
