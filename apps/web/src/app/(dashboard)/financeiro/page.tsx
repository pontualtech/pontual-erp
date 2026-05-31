'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  TrendingUp, TrendingDown, DollarSign, Wallet, AlertTriangle,
  Landmark, FolderTree, Target, CreditCard, BarChart3, FileSpreadsheet,
  Receipt, ArrowRightLeft, Plus,
} from 'lucide-react'
import { toast } from 'sonner'

import { FiltersBar } from './_components/filters-bar'
import { KPICard } from './_components/kpi-card'
import { FluxoChart } from './_components/fluxo-chart'
import { TopDevedores } from './_components/top-devedores'
import { ContasDistribuicao } from './_components/contas-distribuicao'
import { OverdueBanner } from './_components/overdue-banner'
import { QuickLinks } from './_components/quick-links'

interface DashboardData {
  totalBalanceCents: number
  accounts: { id: string; name: string; account_type?: string; current_balance: number | null }[]
  payable: { openCents: number; openCount: number; overdueCents: number; overdueCount: number }
  receivable: { openCents: number; openCount: number; overdueCents: number; overdueCount: number }
  period: { fromISO: string; toISO: string; days: number }
  inflow: { cents: number; count: number }
  outflow: { cents: number; count: number }
  deltas: { inflowPct: number | null; outflowPct: number | null }
  series: { date: string; inflowCents: number; outflowCents: number }[]
  topOverdueReceivables: {
    id: string
    description: string
    customerName: string | null
    customerId: string | null
    openCents: number
    dueDate: string
    daysOverdue: number
  }[]
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function FinanceiroPage() {
  const sp = useSearchParams()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  // URL params determinam query do dashboard
  const qs = useMemo(() => {
    const p = new URLSearchParams()
    for (const k of ['from', 'to', 'accountId', 'categoryId', 'costCenterId', 'paymentMethod', 'search']) {
      const v = sp.get(k)
      if (v) p.set(k, v)
    }
    return p.toString()
  }, [sp])

  // qs do extrato (usa snake_case account_id) — drill-down do KPI "Entradas/Saídas"
  // leva pro extrato filtrado pelo mesmo período.
  const extratoPeriodHref = useMemo(() => {
    const f = sp.get('from'), t = sp.get('to')
    const p = new URLSearchParams()
    if (f) p.set('from', f)
    if (t) p.set('to', t)
    const acc = sp.get('accountId')
    if (acc) p.set('account_id', acc)
    const qsStr = p.toString()
    return `/financeiro/extrato${qsStr ? `?${qsStr}` : ''}`
  }, [sp])

  useEffect(() => {
    // AbortController previne race: cliques rápidos em filtros podem fazer
    // response antiga sobrescrever a nova. AbortError é silenciado.
    const ac = new AbortController()
    setLoading(true)
    fetch(`/api/financeiro/dashboard${qs ? `?${qs}` : ''}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setData(d.data ?? null))
      .catch((err) => {
        if (err?.name !== 'AbortError') toast.error('Erro ao carregar dados financeiros')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [qs])

  // Sparklines de Entradas/Saídas derivados da series. Saldo total NÃO tem
  // sparkline porque reconstrução histórica precisaria considerar transferências
  // internas + ajustes manuais (fora da series AR/AP) — qualquer aproximação
  // visual sem esses dados seria enganosa.
  const inflowSpark = useMemo(() => data?.series.map((s) => s.inflowCents / 100) ?? [], [data])
  const outflowSpark = useMemo(() => data?.series.map((s) => s.outflowCents / 100) ?? [], [data])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Visão geral</p>
          <h1 className="mt-0.5 text-2xl font-semibold text-gray-900">Financeiro</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href="/financeiro/contas-receber/novo"
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100"
          >
            <Plus className="h-4 w-4" />
            Lançar entrada
          </Link>
          <Link
            href="/financeiro/contas-pagar/novo"
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-100"
          >
            <Plus className="h-4 w-4" />
            Lançar despesa
          </Link>
        </div>
      </div>

      <FiltersBar accounts={data?.accounts ?? []} />

      {/* KPIs (5) — md:cols-3 evita aperto em laptop 13-14"; lg+ vira 5-up */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <KPICard
          label="Saldo total"
          value={formatCurrency(data?.totalBalanceCents ?? 0)}
          sub={data?.accounts.length ? `${data.accounts.length} ${data.accounts.length === 1 ? 'conta' : 'contas'}` : null}
          icon={Wallet}
          tone="blue"
          href="/financeiro/contas-bancarias"
          loading={loading}
        />
        <KPICard
          label="Entradas no período"
          value={formatCurrency(data?.inflow.cents ?? 0)}
          sub={data?.inflow.count ? `${data.inflow.count} lançamentos` : null}
          icon={TrendingUp}
          tone="green"
          deltaPct={data?.deltas.inflowPct}
          sparkline={inflowSpark}
          href={extratoPeriodHref}
          loading={loading}
        />
        <KPICard
          label="Saídas no período"
          value={formatCurrency(data?.outflow.cents ?? 0)}
          sub={data?.outflow.count ? `${data.outflow.count} lançamentos` : null}
          icon={TrendingDown}
          tone="red"
          deltaPct={data?.deltas.outflowPct}
          deltaInverse
          sparkline={outflowSpark}
          href={extratoPeriodHref}
          loading={loading}
        />
        <KPICard
          label="A receber"
          value={formatCurrency(data?.receivable.openCents ?? 0)}
          sub={data?.receivable.openCount ? `${data.receivable.openCount} títulos` : null}
          icon={DollarSign}
          tone="green"
          href="/financeiro/contas-receber"
          loading={loading}
        />
        <KPICard
          label="A pagar"
          value={formatCurrency(data?.payable.openCents ?? 0)}
          sub={data?.payable.openCount ? `${data.payable.openCount} títulos` : null}
          icon={DollarSign}
          tone="red"
          href="/financeiro/contas-pagar"
          loading={loading}
        />
      </div>

      {/* Banner de vencidos (ação prioritária) */}
      <OverdueBanner
        receivableOverdueCents={data?.receivable.overdueCents ?? 0}
        receivableOverdueCount={data?.receivable.overdueCount ?? 0}
        payableOverdueCents={data?.payable.overdueCents ?? 0}
        payableOverdueCount={data?.payable.overdueCount ?? 0}
        loading={loading}
      />

      {/* Fluxo de caixa + Top vencidos lado a lado (60/40 em LG) */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <FluxoChart
            series={data?.series ?? []}
            inflowTotalCents={data?.inflow.cents ?? 0}
            outflowTotalCents={data?.outflow.cents ?? 0}
            loading={loading}
          />
        </div>
        <div className="lg:col-span-2">
          <TopDevedores items={data?.topOverdueReceivables ?? []} loading={loading} />
        </div>
      </div>

      {/* Distribuição de contas */}
      <ContasDistribuicao accounts={data?.accounts ?? []} loading={loading} />

      {/* Cadastros + Relatórios (collapsed) */}
      <QuickLinks
        title="Cadastros"
        items={[
          { label: 'Categorias',        href: '/financeiro/categorias',          icon: FolderTree, desc: 'Receitas e despesas',  tone: 'purple' },
          { label: 'Centros de custo',  href: '/financeiro/centros-custo',       icon: Target,     desc: 'Departamentos',         tone: 'blue' },
          { label: 'Contas bancárias',  href: '/financeiro/contas-bancarias',    icon: Landmark,   desc: 'Bancos e caixas',       tone: 'emerald' },
          { label: 'Cond. pagamento',   href: '/financeiro/condicoes-pagamento', icon: CreditCard, desc: 'Parcelamentos',         tone: 'amber' },
          { label: 'Formas de pgto',    href: '/financeiro/formas-pagamento',    icon: CreditCard, desc: 'Dinheiro, PIX, cartão', tone: 'pink' },
        ]}
      />

      <QuickLinks
        title="Relatórios e ferramentas"
        items={[
          { label: 'Extrato',         href: '/financeiro/extrato',           icon: Receipt,         desc: 'Lançamentos por período',  tone: 'violet' },
          { label: 'Relatórios',      href: '/financeiro/relatorios',        icon: BarChart3,       desc: 'Resumo e análises',         tone: 'blue' },
          { label: 'Fluxo de caixa',  href: '/financeiro/fluxo-caixa',       icon: BarChart3,       desc: 'Entradas e saídas',         tone: 'cyan' },
          { label: 'DRE',             href: '/financeiro/dre',               icon: FileSpreadsheet, desc: 'Demonstrativo de resultados', tone: 'indigo' },
          { label: 'Aging A/R',       href: '/financeiro/relatorios/aging',  icon: AlertTriangle,   desc: 'Inadimplência por faixa',   tone: 'rose' },
          { label: 'Conciliação',     href: '/financeiro/conciliacao',       icon: Receipt,         desc: 'Importar OFX',              tone: 'teal' },
          { label: 'Boletos',         href: '/financeiro/boletos',           icon: Receipt,         desc: 'Emitir e gerenciar',        tone: 'orange' },
          { label: 'CNAB Inter',      href: '/financeiro/cnab',              icon: FileSpreadsheet, desc: 'Remessa e retorno CNAB',    tone: 'amber' },
          { label: 'Maquininha',      href: '/financeiro/maquininha',        icon: CreditCard,      desc: 'Conciliação cartão Rede',   tone: 'rose' },
          { label: 'Transferência',   href: '/financeiro/transferencia',     icon: ArrowRightLeft,  desc: 'Mover saldo entre bancos',  tone: 'sky' },
        ]}
      />
    </div>
  )
}
