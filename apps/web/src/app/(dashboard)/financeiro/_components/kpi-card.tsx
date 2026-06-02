'use client'

import Link from 'next/link'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { ArrowDownRight, ArrowUpRight, ArrowRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  label: string
  value: string
  sub?: string | null
  icon: LucideIcon
  // Cor temática do ícone: 'green' | 'red' | 'amber' | 'blue' | 'slate'
  tone: 'green' | 'red' | 'amber' | 'orange' | 'blue' | 'slate'
  // Delta %: positivo = melhora (verde p/ entrada, vermelho p/ saída),
  // null = sem comparativo. Boolean inverse pra inverter semântica.
  deltaPct?: number | null
  // Quando true, delta positivo é RUIM (ex: A Pagar subiu = pior).
  deltaInverse?: boolean
  // Mini série pro sparkline. Cada item: número (valor do dia).
  sparkline?: number[]
  // Loading skeleton
  loading?: boolean
  // Quando passado, o card vira clicável (drill-down). Tooltip pelo title.
  href?: string
}

const toneClasses = {
  green:  { bg: 'bg-emerald-50', text: 'text-emerald-600', stroke: '#059669' },
  red:    { bg: 'bg-red-50',     text: 'text-red-600',     stroke: '#dc2626' },
  amber:  { bg: 'bg-amber-50',   text: 'text-amber-600',   stroke: '#d97706' },
  orange: { bg: 'bg-orange-50',  text: 'text-orange-600',  stroke: '#ea580c' },
  blue:   { bg: 'bg-blue-50',    text: 'text-blue-600',    stroke: '#2563eb' },
  slate:  { bg: 'bg-slate-100',  text: 'text-slate-500',   stroke: '#64748b' },
}

export function KPICard({ label, value, sub, icon: Icon, tone, deltaPct, deltaInverse, sparkline, loading, href }: Props) {
  const t = toneClasses[tone]
  const hasDelta = deltaPct !== null && deltaPct !== undefined && Number.isFinite(deltaPct)
  const goodDirection = deltaInverse ? (deltaPct ?? 0) < 0 : (deltaPct ?? 0) > 0
  const deltaColor = hasDelta
    ? goodDirection ? 'text-emerald-600' : 'text-red-600'
    : 'text-gray-400'
  const DeltaIcon = (deltaPct ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight

  const chartData = (sparkline ?? []).map((v, i) => ({ i, v }))

  // Wrapper: <Link> quando href, <div> caso contrário. Mesma classe base.
  const Wrapper: any = href ? Link : 'div'
  const wrapperProps: any = href
    ? { href, className: 'group relative block overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgb(0,0,0,0.04)] transition-all hover:-translate-y-px hover:border-gray-300 hover:shadow-md cursor-pointer' }
    : { className: 'group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgb(0,0,0,0.04)] transition-shadow hover:shadow-md' }

  return (
    <Wrapper {...wrapperProps}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-gray-500" title={label}>{label}</p>
          {/* Font responsive: shrink em viewports onde 5 cards lutam por espaço.
              text-xl (20px) → sm:text-[22px] → xl:text-[24px] → 2xl:text-[26px].
              Sem truncate (era cortando "R$ 142.207,46" pra "R..." em laptop 14").
              break-words deixa quebrar se passar dos limites. tabular-nums alinha dígitos. */}
          <p className="mt-1.5 text-xl font-semibold leading-tight text-gray-900 tabular-nums break-words sm:text-[22px] xl:text-[24px] 2xl:text-[26px]">
            {loading ? <span className="inline-block h-7 w-32 animate-pulse rounded bg-gray-200" /> : value}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {sub && <span className="text-gray-500">{sub}</span>}
            {hasDelta && (
              <span className={cn('inline-flex items-center gap-0.5 font-medium tabular-nums', deltaColor)}>
                <DeltaIcon className="h-3.5 w-3.5" />
                {Math.abs(deltaPct as number).toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <div className={cn('flex-none rounded-lg p-2.5', t.bg)}>
          <Icon className={cn('h-5 w-5', t.text)} />
        </div>
      </div>

      {chartData.length > 1 && (
        <div className="-mb-2 -ml-1 -mr-1 mt-3 h-10 opacity-90 transition-opacity group-hover:opacity-100">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
              <Line type="monotone" dataKey="v" stroke={t.stroke} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {href && (
        <div className="mt-3 flex items-center gap-1 text-xs font-medium text-blue-600 transition-colors group-hover:text-blue-700">
          Ver detalhes
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </div>
      )}
    </Wrapper>
  )
}
