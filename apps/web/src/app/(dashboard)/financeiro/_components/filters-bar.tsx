'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Calendar, ChevronDown, Filter, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DateInputBR } from '@/app/(dashboard)/components/date-input-br'
import { PRESETS, rangeForPreset, detectPreset, formatBR, type PeriodPreset } from '@/lib/financeiro/period-presets'

interface Account {
  id: string
  name: string
  account_type?: string
}

interface Props {
  accounts: Account[]
}

// Filtros globais do dashboard financeiro. Estado vive na URL — refresh-safe
// e shareable. Atualiza via router.replace pra não empilhar histórico.
export function FiltersBar({ accounts }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const from = sp.get('from') || rangeForPreset('30d').from
  const to = sp.get('to') || rangeForPreset('30d').to
  const accountId = sp.get('accountId') || ''

  const preset = useMemo(() => detectPreset(from, to), [from, to])
  const selectedAccount = accounts.find((a) => a.id === accountId)

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(sp.toString())
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === '') params.delete(k)
        else params.set(k, v)
      }
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, sp],
  )

  const applyPreset = (p: PeriodPreset) => {
    const r = rangeForPreset(p)
    setParams({ from: r.from, to: r.to })
  }

  const hasFilters = preset !== '30d' || accountId

  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-gray-200 bg-white/85 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {/* Período */}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-900 transition-colors hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
              aria-label="Filtrar por período"
            >
              <Calendar className="h-4 w-4 text-gray-500" />
              <span className="tabular-nums">{periodLabel(from, to, preset)}</span>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={4}
              className="z-30 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
            >
              <PeriodPicker
                from={from}
                to={to}
                currentPreset={preset}
                onPreset={applyPreset}
                onCustom={(f, t) => setParams({ from: f, to: t })}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {/* Conta bancária */}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              className={cn(
                'inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
                accountId
                  ? 'border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100'
                  : 'border-gray-200 bg-white text-gray-900 hover:border-gray-300 hover:bg-gray-50',
              )}
              aria-label="Filtrar por conta bancária"
            >
              <BankIcon />
              <span>{selectedAccount?.name ?? 'Todas as contas'}</span>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={4}
              className="z-30 w-64 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg"
            >
              <button
                onClick={() => setParams({ accountId: null })}
                className={cn(
                  'flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-2 text-sm transition-colors hover:bg-gray-50',
                  !accountId && 'bg-gray-50 font-medium',
                )}
              >
                <span className="text-gray-900">Todas as contas</span>
                {!accountId && <Check />}
              </button>
              <div className="my-1 h-px bg-gray-100" />
              {accounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setParams({ accountId: a.id })}
                  className={cn(
                    'flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-2 text-sm transition-colors hover:bg-gray-50',
                    accountId === a.id && 'bg-gray-50 font-medium',
                  )}
                >
                  <span className="text-gray-900">{a.name}</span>
                  {accountId === a.id && <Check />}
                </button>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {hasFilters && (
          <button
            onClick={() => {
              const r = rangeForPreset('30d')
              setParams({ from: r.from, to: r.to, accountId: null, categoryId: null, costCenterId: null })
            }}
            className="ml-auto inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Limpar filtros"
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </button>
        )}
      </div>
    </div>
  )
}

function periodLabel(from: string, to: string, preset: PeriodPreset): string {
  if (preset === 'custom') return `${formatBR(from)} – ${formatBR(to)}`
  const found = PRESETS.find((p) => p.value === preset)
  return found?.label ?? `${formatBR(from)} – ${formatBR(to)}`
}

function PeriodPicker({
  from,
  to,
  currentPreset,
  onPreset,
  onCustom,
}: {
  from: string
  to: string
  currentPreset: PeriodPreset
  onPreset: (p: PeriodPreset) => void
  onCustom: (from: string, to: string) => void
}) {
  const [customFrom, setCustomFrom] = useState(from)
  const [customTo, setCustomTo] = useState(to)

  return (
    <div>
      <div className="grid grid-cols-2 gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => onPreset(p.value)}
            className={cn(
              'h-8 cursor-pointer rounded px-2 text-xs font-medium transition-colors',
              currentPreset === p.value
                ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
                : 'text-gray-700 hover:bg-gray-50',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="my-3 h-px bg-gray-100" />
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Personalizado</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="period-from" className="mb-1 block text-[11px] text-gray-500">De</label>
          <DateInputBR id="period-from" value={customFrom} onChange={setCustomFrom}
            className="h-8 w-full rounded border border-gray-200 px-2 text-xs tabular-nums focus:border-blue-500 focus:outline-none" />
        </div>
        <div>
          <label htmlFor="period-to" className="mb-1 block text-[11px] text-gray-500">Até</label>
          <DateInputBR id="period-to" value={customTo} onChange={setCustomTo}
            className="h-8 w-full rounded border border-gray-200 px-2 text-xs tabular-nums focus:border-blue-500 focus:outline-none" />
        </div>
      </div>
      <button
        onClick={() => onCustom(customFrom, customTo)}
        disabled={!customFrom || !customTo}
        className="mt-2 h-8 w-full cursor-pointer rounded bg-gray-900 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Aplicar
      </button>
    </div>
  )
}

function BankIcon() {
  return (
    <svg className="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18" />
      <path d="M3 10h18" />
      <path d="M5 6l7-3 7 3" />
      <path d="M4 10v11" />
      <path d="M20 10v11" />
      <path d="M8 14v3" />
      <path d="M12 14v3" />
      <path d="M16 14v3" />
    </svg>
  )
}

function Check() {
  return (
    <svg className="h-4 w-4 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
