'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, Legend, PieChart, Pie,
} from 'recharts'
import {
  BarChart3, Download, Users, Clock, TrendingUp, Filter, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR')
}

function getDefaultDateRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const to = now.toISOString().split('T')[0]
  return { from, to }
}

function downloadCSV(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(';'),
    ...rows.map(r => headers.map(h => {
      const v = r[h]
      return typeof v === 'string' && v.includes(';') ? `"${v}"` : v
    }).join(';')),
  ].join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']
const TABS = [
  { id: 'produtividade', label: 'Produtividade', icon: Users },
  { id: 'sla', label: 'SLA', icon: Clock },
  { id: 'margem', label: 'Margem', icon: TrendingUp },
  { id: 'comissao', label: 'Comissao', icon: BarChart3 },
  { id: 'funil', label: 'Funil', icon: Filter },
] as const

type TabId = typeof TABS[number]['id']

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function RelatoriosBIPage() {
  const [tab, setTab] = useState<TabId>('produtividade')
  const defaults = getDefaultDateRange()
  const [dateFrom, setDateFrom] = useState(defaults.from)
  const [dateTo, setDateTo] = useState(defaults.to)
  const [loading, setLoading] = useState(false)

  // Data states
  const [prodData, setProdData] = useState<any>(null)
  const [slaData, setSlaData] = useState<any>(null)
  const [margemData, setMargemData] = useState<any>(null)
  const [comissaoData, setComissaoData] = useState<any>(null)
  const [funilData, setFunilData] = useState<any>(null)
  const [commissionPct, setCommissionPct] = useState(10)

  const fetchTab = useCallback(async (t: TabId) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ dateFrom, dateTo })
      if (t === 'comissao') params.set('commissionPercent', String(commissionPct))
      const res = await fetch(`/api/relatorios/${t}?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erro')
      const data = json.data
      switch (t) {
        case 'produtividade': setProdData(data); break
        case 'sla': setSlaData(data); break
        case 'margem': setMargemData(data); break
        case 'comissao': setComissaoData(data); break
        case 'funil': setFunilData(data); break
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro ao carregar relatorio')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, commissionPct])

  useEffect(() => { fetchTab(tab) }, [tab, dateFrom, dateTo, fetchTab])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">BI / Relatorios</h1>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
          />
          <span className="text-gray-400">ate</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                tab === t.id
                  ? 'bg-white text-blue-700 shadow dark:bg-gray-700 dark:text-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      )}

      {/* Tab content */}
      {!loading && tab === 'produtividade' && prodData && <ProdutividadeTab data={prodData} />}
      {!loading && tab === 'sla' && slaData && <SlaTab data={slaData} />}
      {!loading && tab === 'margem' && margemData && <MargemTab data={margemData} />}
      {!loading && tab === 'comissao' && comissaoData && (
        <ComissaoTab data={comissaoData} commissionPct={commissionPct} setCommissionPct={setCommissionPct} onRefresh={() => fetchTab('comissao')} />
      )}
      {!loading && tab === 'funil' && funilData && <FunilTab data={funilData} />}
    </div>
  )
}

// ─── Card Component ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-5 shadow-sm">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold', color)}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

// ─── Produtividade Tab ───────────────────────────────────────────────────────

function ProdutividadeTab({ data }: { data: any }) {
  const { technicians, summary } = data

  function exportCSV() {
    downloadCSV(technicians.map((t: any) => ({
      Tecnico: t.technicianName,
      'OS Concluidas': t.totalCompleted,
      'Tempo Medio (h)': t.avgRepairHours,
      'Retrabalhos': t.reworkCount,
      'Retrabalho %': t.reworkPercent,
      'Faturamento': formatCurrency(t.revenueCents),
    })), 'produtividade')
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="OS Concluidas" value={String(summary.totalCompleted)} color="text-blue-600" />
        <StatCard label="Tempo Medio (h)" value={String(summary.avgRepairHours)} color="text-amber-600" />
        <StatCard label="Faturamento Total" value={formatCurrency(summary.totalRevenueCents)} color="text-emerald-600" />
      </div>

      {/* Chart */}
      {technicians.length > 0 && (
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">OS Concluidas por Tecnico</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={technicians} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="technicianName" type="category" width={120} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: number, name: string) => {
                if (name === 'totalCompleted') return [v, 'OS']
                if (name === 'avgRepairHours') return [`${v}h`, 'Tempo Medio']
                return [v, name]
              }} />
              <Legend />
              <Bar dataKey="totalCompleted" name="OS Concluidas" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              <Bar dataKey="avgRepairHours" name="Tempo Medio (h)" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm">
        <div className="flex items-center justify-between border-b dark:border-gray-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Detalhamento por Tecnico</h3>
          <button onClick={exportCSV} className="flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3">Tecnico</th>
                <th className="px-4 py-3 text-right">OS Concluidas</th>
                <th className="px-4 py-3 text-right">Tempo Medio (h)</th>
                <th className="px-4 py-3 text-right">Retrabalhos</th>
                <th className="px-4 py-3 text-right">Retrabalho %</th>
                <th className="px-4 py-3 text-right">Faturamento</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {technicians.map((t: any) => (
                <tr key={t.technicianId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{t.technicianName}</td>
                  <td className="px-4 py-3 text-right">{t.totalCompleted}</td>
                  <td className="px-4 py-3 text-right">{t.avgRepairHours}h</td>
                  <td className="px-4 py-3 text-right">{t.reworkCount}</td>
                  <td className="px-4 py-3 text-right">{t.reworkPercent}%</td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(t.revenueCents)}</td>
                </tr>
              ))}
              {technicians.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum dado encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── SLA Tab ─────────────────────────────────────────────────────────────────

function GaugeChart({ percent, label, color }: { percent: number; label: string; color: string }) {
  const data = [
    { name: 'value', value: percent },
    { name: 'rest', value: 100 - percent },
  ]
  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width={160} height={100}>
        <PieChart>
          <Pie
            data={data}
            startAngle={180}
            endAngle={0}
            cx="50%"
            cy="100%"
            innerRadius={50}
            outerRadius={70}
            dataKey="value"
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill="#e5e7eb" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <p className="mt-[-8px] text-2xl font-bold" style={{ color }}>{percent}%</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
    </div>
  )
}

function SlaTab({ data }: { data: any }) {
  const { statusTimes, sla, overdueList } = data

  function exportCSV() {
    downloadCSV(overdueList.map((o: any) => ({
      OS: o.osNumber,
      Equipamento: o.equipmentType,
      Cliente: o.customerName,
      Tecnico: o.technicianName || '-',
      Status: o.statusName,
      'Horas Aberta': o.hoursOpen,
      Abertura: formatDate(o.createdAt),
    })), 'sla-atrasadas')
  }

  return (
    <div className="space-y-6">
      {/* Gauges */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Total OS" value={String(sla.totalOs)} color="text-blue-600" />
        <StatCard label="Concluidas" value={String(sla.totalCompleted)} color="text-emerald-600" />
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4 shadow-sm flex items-center justify-center">
          <GaugeChart percent={sla.slaRepairPercent} label="Dentro do SLA (10d)" color={sla.slaRepairPercent >= 80 ? '#10b981' : sla.slaRepairPercent >= 50 ? '#f59e0b' : '#ef4444'} />
        </div>
        <StatCard label="Atrasadas (>10d)" value={String(sla.overdueCount)} color="text-red-600" />
      </div>

      {/* Avg time per status */}
      {statusTimes.length > 0 && (
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Tempo Medio por Status (horas)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={statusTimes}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="statusName" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v}h`, 'Tempo Medio']} />
              <Bar dataKey="avgHours" name="Horas" radius={[4, 4, 0, 0]}>
                {statusTimes.map((s: any, i: number) => (
                  <Cell key={i} fill={s.color || COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Overdue table */}
      <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm">
        <div className="flex items-center justify-between border-b dark:border-gray-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">OS Atrasadas (&gt;10 dias)</h3>
          <button onClick={exportCSV} className="flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3">OS</th>
                <th className="px-4 py-3">Equipamento</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Tecnico</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Horas Aberta</th>
                <th className="px-4 py-3">Abertura</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {overdueList.map((o: any) => (
                <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-medium text-blue-600">#{o.osNumber}</td>
                  <td className="px-4 py-3">{o.equipmentType} {o.equipmentBrand} {o.equipmentModel}</td>
                  <td className="px-4 py-3">{o.customerName}</td>
                  <td className="px-4 py-3">{o.technicianName || '-'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: o.statusColor || '#6b7280' }}>
                      {o.statusName}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-red-600">{Math.round(o.hoursOpen)}h</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(o.createdAt)}</td>
                </tr>
              ))}
              {overdueList.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Nenhuma OS atrasada</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Margem Tab ──────────────────────────────────────────────────────────────

function MargemTab({ data }: { data: any }) {
  const { summary, top10Profitable, top10Least, byEquipmentType } = data

  function exportCSV() {
    downloadCSV([...top10Profitable, ...top10Least].map((m: any) => ({
      OS: m.osNumber,
      Equipamento: m.equipmentType,
      Cliente: m.customerName,
      Receita: formatCurrency(m.revenueCents),
      Custo: formatCurrency(m.costCents),
      Margem: formatCurrency(m.marginCents),
      'Margem %': `${m.marginPercent}%`,
    })), 'margem-os')
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Total OS" value={String(summary.totalOs)} color="text-blue-600" />
        <StatCard label="Receita Total" value={formatCurrency(summary.totalRevenueCents)} color="text-emerald-600" />
        <StatCard label="Custo Total" value={formatCurrency(summary.totalCostCents)} color="text-red-600" />
        <StatCard label="Margem Media" value={`${summary.avgMarginPercent}%`} color={summary.avgMarginPercent >= 30 ? 'text-emerald-600' : 'text-amber-600'} />
      </div>

      {/* Chart by equipment type */}
      {byEquipmentType.length > 0 && (
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Margem Media por Tipo de Equipamento</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byEquipmentType}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="equipmentType" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v: number) => [`${v}%`, 'Margem']} />
              <Bar dataKey="avgMarginPercent" name="Margem %" radius={[4, 4, 0, 0]}>
                {byEquipmentType.map((_: any, i: number) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top 10 / Bottom 10 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MargemTable title="Top 10 Mais Lucrativas" rows={top10Profitable} exportCSV={exportCSV} positive />
        <MargemTable title="Top 10 Menos Lucrativas" rows={top10Least} exportCSV={exportCSV} positive={false} />
      </div>
    </div>
  )
}

function MargemTable({ title, rows, exportCSV, positive }: { title: string; rows: any[]; exportCSV: () => void; positive: boolean }) {
  return (
    <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm">
      <div className="flex items-center justify-between border-b dark:border-gray-700 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
        <button onClick={exportCSV} className="flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600">
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-4 py-3">OS</th>
              <th className="px-4 py-3">Equipamento</th>
              <th className="px-4 py-3 text-right">Receita</th>
              <th className="px-4 py-3 text-right">Custo</th>
              <th className="px-4 py-3 text-right">Margem</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {rows.map((m: any) => (
              <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3 font-medium text-blue-600">#{m.osNumber}</td>
                <td className="px-4 py-3">{m.equipmentType}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(m.revenueCents)}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(m.costCents)}</td>
                <td className={cn('px-4 py-3 text-right font-medium', m.marginPercent >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                  {m.marginPercent}%
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Nenhum dado</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Comissao Tab ────────────────────────────────────────────────────────────

function ComissaoTab({ data, commissionPct, setCommissionPct, onRefresh }: {
  data: any; commissionPct: number; setCommissionPct: (n: number) => void; onRefresh: () => void
}) {
  const { technicians, summary } = data

  function exportCSV() {
    downloadCSV(technicians.map((t: any) => ({
      Tecnico: t.technicianName,
      'OS Concluidas': t.osCount,
      Faturamento: formatCurrency(t.revenueCents),
      'Comissao %': `${t.commissionPercent}%`,
      'Comissao R$': formatCurrency(t.commissionCents),
    })), 'comissao')
  }

  return (
    <div className="space-y-6">
      {/* Commission rate config */}
      <div className="flex items-center gap-4 rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4 shadow-sm">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Comissao %:</label>
        <input
          type="number"
          min={0}
          max={100}
          value={commissionPct}
          onChange={e => setCommissionPct(Number(e.target.value))}
          className="w-20 rounded-md border px-3 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
        />
        <button
          onClick={onRefresh}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Recalcular
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total OS" value={String(summary.totalOs)} color="text-blue-600" />
        <StatCard label="Faturamento Total" value={formatCurrency(summary.totalRevenueCents)} color="text-emerald-600" />
        <StatCard label="Total Comissoes" value={formatCurrency(summary.totalCommissionCents)} color="text-amber-600" />
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm">
        <div className="flex items-center justify-between border-b dark:border-gray-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Comissao por Tecnico</h3>
          <button onClick={exportCSV} className="flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3">Tecnico</th>
                <th className="px-4 py-3 text-right">OS Concluidas</th>
                <th className="px-4 py-3 text-right">Faturamento</th>
                <th className="px-4 py-3 text-right">Comissao %</th>
                <th className="px-4 py-3 text-right">Comissao R$</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {technicians.map((t: any) => (
                <tr key={t.technicianId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{t.technicianName}</td>
                  <td className="px-4 py-3 text-right">{t.osCount}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(t.revenueCents)}</td>
                  <td className="px-4 py-3 text-right">{t.commissionPercent}%</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-600">{formatCurrency(t.commissionCents)}</td>
                </tr>
              ))}
              {technicians.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Nenhum dado encontrado</td></tr>
              )}
            </tbody>
            {technicians.length > 0 && (
              <tfoot className="bg-gray-50 dark:bg-gray-700/50 font-bold">
                <tr>
                  <td className="px-4 py-3">TOTAL</td>
                  <td className="px-4 py-3 text-right">{summary.totalOs}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(summary.totalRevenueCents)}</td>
                  <td className="px-4 py-3 text-right">{commissionPct}%</td>
                  <td className="px-4 py-3 text-right text-amber-600">{formatCurrency(summary.totalCommissionCents)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Funil Tab ───────────────────────────────────────────────────────────────

function FunilTab({ data }: { data: any }) {
  const { steps, conversions } = data
  const maxCount = Math.max(...steps.map((s: any) => s.count), 1)

  function exportCSV() {
    downloadCSV(steps.map((s: any) => ({
      Etapa: s.name,
      Quantidade: s.count,
      'Percentual': `${s.percent}%`,
    })), 'funil')
  }

  return (
    <div className="space-y-6">
      {/* Funnel visualization */}
      <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Funil de Conversao</h3>
          <button onClick={exportCSV} className="flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>

        <div className="space-y-3">
          {steps.map((step: any, i: number) => {
            const widthPct = maxCount > 0 ? Math.max((step.count / maxCount) * 100, 8) : 8
            return (
              <div key={step.name}>
                <div className="flex items-center gap-4">
                  <div className="w-24 text-right text-sm font-medium text-gray-600 dark:text-gray-400 shrink-0">
                    {step.name}
                  </div>
                  <div className="flex-1">
                    <div
                      className="flex items-center justify-between rounded-md px-3 py-2.5 text-white text-sm font-medium transition-all"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: COLORS[i % COLORS.length],
                        minWidth: '80px',
                      }}
                    >
                      <span>{step.count}</span>
                      <span className="text-xs opacity-80">{step.percent}%</span>
                    </div>
                  </div>
                </div>
                {/* Conversion arrow between steps */}
                {i < conversions.length && (
                  <div className="ml-28 flex items-center gap-2 py-1">
                    <ChevronDown className="h-3.5 w-3.5 text-gray-300" />
                    <span className={cn(
                      'text-xs font-medium',
                      conversions[i].rate >= 70 ? 'text-emerald-600' : conversions[i].rate >= 40 ? 'text-amber-600' : 'text-red-500'
                    )}>
                      {conversions[i].rate}% conversao
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Conversion rates table */}
      <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm">
        <div className="border-b dark:border-gray-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Taxas de Conversao entre Etapas</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3">De</th>
                <th className="px-4 py-3">Para</th>
                <th className="px-4 py-3 text-right">Taxa</th>
                <th className="px-4 py-3">Indicador</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {conversions.map((c: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{c.from}</td>
                  <td className="px-4 py-3">{c.to}</td>
                  <td className="px-4 py-3 text-right font-bold">{c.rate}%</td>
                  <td className="px-4 py-3">
                    <div className="w-full max-w-[200px] rounded-full bg-gray-200 dark:bg-gray-600 h-2.5">
                      <div
                        className={cn('h-2.5 rounded-full', c.rate >= 70 ? 'bg-emerald-500' : c.rate >= 40 ? 'bg-amber-500' : 'bg-red-500')}
                        style={{ width: `${Math.min(c.rate, 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
