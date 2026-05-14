'use client'

import { type LucideIcon } from 'lucide-react'
import { formatNumber } from '@/lib/marketing/format'

interface Props {
  label: string
  value: number | string | null | undefined
  hint?: string
  icon?: LucideIcon
  /** Cor temática do card (verde=positivo, amber=atenção, etc) */
  tone?: 'default' | 'green' | 'blue' | 'amber' | 'rose' | 'gray'
  /** Delta vs período anterior, em %. Positivo = verde, negativo = vermelho. */
  delta?: number | null
  /** Link clicável (página inteira vira interativa) */
  href?: string
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default', delta, href }: Props) {
  const toneClasses: Record<string, string> = {
    default: 'border-gray-200 dark:border-gray-700',
    green:   'border-green-200 dark:border-green-500/30',
    blue:    'border-blue-200 dark:border-blue-500/30',
    amber:   'border-amber-200 dark:border-amber-500/30',
    rose:    'border-rose-200 dark:border-rose-500/30',
    gray:    'border-gray-200 dark:border-gray-700',
  }
  const iconToneClasses: Record<string, string> = {
    default: 'text-gray-400',
    green:   'text-green-600 dark:text-green-400',
    blue:    'text-blue-600 dark:text-blue-400',
    amber:   'text-amber-600 dark:text-amber-400',
    rose:    'text-rose-600 dark:text-rose-400',
    gray:    'text-gray-400',
  }

  const formattedValue =
    typeof value === 'number' ? formatNumber(value)
    : value ?? '—'

  const Wrapper: any = href ? 'a' : 'div'
  const wrapperProps = href ? { href, className: 'block' } : {}

  return (
    <Wrapper {...wrapperProps}>
      <div
        className={`group relative overflow-hidden rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md dark:bg-gray-800 ${toneClasses[tone]} ${href ? 'cursor-pointer' : ''}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-gray-500 dark:text-gray-400">
              {label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {formattedValue}
            </div>
            {hint && (
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</div>
            )}
            {delta !== undefined && delta !== null && (
              <div className={`mt-2 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                delta > 0
                  ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300'
                  : delta < 0
                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}>
                {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} {Math.abs(delta).toFixed(1)}%
              </div>
            )}
          </div>
          {Icon && (
            <div className={`shrink-0 ${iconToneClasses[tone]}`}>
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  )
}
