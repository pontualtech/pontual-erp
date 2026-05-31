'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Calendar, ChevronDown, FolderTree, Search, Target, Wallet, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DateInputBR } from '@/app/(dashboard)/components/date-input-br'
import { PRESETS, rangeForPreset, detectPreset, formatBR, type PeriodPreset } from '@/lib/financeiro/period-presets'

interface Account {
  id: string
  name: string
  account_type?: string
}

interface Lookup { id: string; name: string }

interface Props {
  accounts: Account[]
}

// Filtros globais do dashboard financeiro. Estado vive na URL — refresh-safe
// e shareable. Atualiza via router.replace pra não empilhar histórico.
//
// Filtros suportados (URL params):
//   from, to        — período (DateRangePicker + presets)
//   accountId       — conta bancária
//   categoryId      — categoria
//   costCenterId    — centro de custo
//   paymentMethod   — forma de pagamento
//   search          — busca livre (description/cliente)
export function FiltersBar({ accounts }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const from = sp.get('from') || rangeForPreset('30d').from
  const to = sp.get('to') || rangeForPreset('30d').to
  const accountId = sp.get('accountId') || ''
  const categoryId = sp.get('categoryId') || ''
  const costCenterId = sp.get('costCenterId') || ''
  const paymentMethod = sp.get('paymentMethod') || ''
  const search = sp.get('search') || ''

  const preset = useMemo(() => detectPreset(from, to), [from, to])
  const selectedAccount = accounts.find((a) => a.id === accountId)

  // Lookups carregados sob demanda quando o popover abre (lazy fetch)
  const [categories, setCategories] = useState<Lookup[] | null>(null)
  const [costCenters, setCostCenters] = useState<Lookup[] | null>(null)
  const [paymentMethods, setPaymentMethods] = useState<Lookup[] | null>(null)

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

  const selectedCategory = categories?.find((c) => c.id === categoryId)
  const selectedCostCenter = costCenters?.find((c) => c.id === costCenterId)
  const selectedPaymentMethod = paymentMethods?.find((p) => p.id === paymentMethod || p.name === paymentMethod)

  const hasFilters = preset !== '30d' || accountId || categoryId || costCenterId || paymentMethod || search

  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-gray-200 bg-white/85 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {/* Período */}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button"
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
        <FilterPicker
          icon={Wallet}
          label={selectedAccount?.name ?? 'Todas as contas'}
          active={!!accountId}
          ariaLabel="Filtrar por conta bancária"
        >
          <PickerList
            allLabel="Todas as contas"
            current={accountId}
            items={accounts.map((a) => ({ id: a.id, name: a.name }))}
            onSelect={(id) => setParams({ accountId: id })}
            loading={false}
          />
        </FilterPicker>

        {/* Categoria */}
        <FilterPicker
          icon={FolderTree}
          label={selectedCategory?.name ?? (categoryId ? 'Categoria...' : 'Todas categorias')}
          active={!!categoryId}
          ariaLabel="Filtrar por categoria"
          onOpen={() => {
            if (categories === null) {
              fetch('/api/financeiro/categorias?simple=1')
                .then((r) => r.json())
                .then((d) => setCategories(Array.isArray(d.data) ? d.data.map((c: any) => ({ id: c.id, name: c.name })) : []))
                .catch(() => setCategories([]))
            }
          }}
        >
          <PickerList
            allLabel="Todas as categorias"
            current={categoryId}
            items={categories ?? []}
            onSelect={(id) => setParams({ categoryId: id })}
            loading={categories === null}
            emptyHint="Nenhuma categoria cadastrada"
          />
        </FilterPicker>

        {/* Centro de Custo */}
        <FilterPicker
          icon={Target}
          label={selectedCostCenter?.name ?? (costCenterId ? 'Centro...' : 'Todos centros')}
          active={!!costCenterId}
          ariaLabel="Filtrar por centro de custo"
          onOpen={() => {
            if (costCenters === null) {
              fetch('/api/financeiro/centros-custo?simple=1')
                .then((r) => r.json())
                .then((d) => setCostCenters(Array.isArray(d.data) ? d.data.map((c: any) => ({ id: c.id, name: c.name })) : []))
                .catch(() => setCostCenters([]))
            }
          }}
        >
          <PickerList
            allLabel="Todos os centros de custo"
            current={costCenterId}
            items={costCenters ?? []}
            onSelect={(id) => setParams({ costCenterId: id })}
            loading={costCenters === null}
            emptyHint="Nenhum centro de custo cadastrado"
          />
        </FilterPicker>

        {/* Forma de pagamento */}
        <FilterPicker
          icon={CreditCardIcon}
          label={selectedPaymentMethod?.name ?? paymentMethod ?? 'Todas formas'}
          active={!!paymentMethod}
          ariaLabel="Filtrar por forma de pagamento"
          onOpen={() => {
            if (paymentMethods === null) {
              fetch('/api/financeiro/formas-pagamento?simple=1')
                .then((r) => r.json())
                .then((d) => setPaymentMethods(Array.isArray(d.data) ? d.data.map((p: any) => ({ id: p.id ?? p.name, name: p.name })) : []))
                .catch(() => setPaymentMethods([]))
            }
          }}
        >
          <PickerList
            allLabel="Todas as formas"
            current={paymentMethod}
            items={paymentMethods ?? []}
            onSelect={(id) => setParams({ paymentMethod: id })}
            loading={paymentMethods === null}
            emptyHint="Nenhuma forma cadastrada"
          />
        </FilterPicker>

        {/* Busca livre (debounced) */}
        <SearchInput value={search} onChange={(v) => setParams({ search: v || null })} />

        {hasFilters && (
          <button type="button"
            onClick={() => {
              const r = rangeForPreset('30d')
              setParams({
                from: r.from, to: r.to,
                accountId: null, categoryId: null, costCenterId: null,
                paymentMethod: null, search: null,
              })
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

// ---------- helpers ----------

function periodLabel(from: string, to: string, preset: PeriodPreset): string {
  if (preset === 'custom') return `${formatBR(from)} – ${formatBR(to)}`
  const found = PRESETS.find((p) => p.value === preset)
  return found?.label ?? `${formatBR(from)} – ${formatBR(to)}`
}

function FilterPicker({
  icon: Icon,
  label,
  active,
  ariaLabel,
  onOpen,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  ariaLabel: string
  onOpen?: () => void
  children: React.ReactNode
}) {
  return (
    <Popover.Root onOpenChange={(open) => open && onOpen?.()}>
      <Popover.Trigger asChild>
        <button type="button"
          className={cn(
            'inline-flex h-9 max-w-[200px] cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
            active
              ? 'border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100'
              : 'border-gray-200 bg-white text-gray-900 hover:border-gray-300 hover:bg-gray-50',
          )}
          aria-label={ariaLabel}
        >
          <Icon className="h-4 w-4 flex-none text-gray-500" />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 flex-none text-gray-400" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-30 w-64 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function PickerList({
  allLabel,
  current,
  items,
  onSelect,
  loading,
  emptyHint,
}: {
  allLabel: string
  current: string
  items: Lookup[]
  onSelect: (id: string | null) => void
  loading: boolean
  emptyHint?: string
}) {
  return (
    <div className="max-h-64 overflow-y-auto">
      <button type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-2 text-sm transition-colors hover:bg-gray-50',
          !current && 'bg-gray-50 font-medium',
        )}
      >
        <span className="text-gray-900">{allLabel}</span>
        {!current && <Check />}
      </button>
      {(items.length > 0 || !loading) && <div className="my-1 h-px bg-gray-100" />}
      {loading ? (
        <div className="px-2.5 py-3 text-xs text-gray-400">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="px-2.5 py-3 text-xs text-gray-400">{emptyHint ?? 'Sem opções'}</div>
      ) : (
        items.map((it) => (
          <button type="button"
            key={it.id}
            onClick={() => onSelect(it.id)}
            className={cn(
              'flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-2 text-left text-sm transition-colors hover:bg-gray-50',
              current === it.id && 'bg-gray-50 font-medium',
            )}
          >
            <span className="truncate pr-2 text-gray-900">{it.name}</span>
            {current === it.id && <Check />}
          </button>
        ))
      )}
    </div>
  )
}

// Input de busca com debounce de 300ms — evita query spam por keystroke.
function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sincroniza quando URL muda externamente (back/forward, clear)
  useEffect(() => { setLocal(value) }, [value])

  const handleChange = (v: string) => {
    setLocal(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onChange(v), 300)
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Buscar..."
        aria-label="Buscar por descrição ou cliente"
        className="h-9 w-48 rounded-md border border-gray-200 bg-white pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
    </div>
  )
}

function PeriodPicker({
  from, to, currentPreset, onPreset, onCustom,
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
          <button type="button"
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
      <button type="button"
        onClick={() => onCustom(customFrom, customTo)}
        disabled={!customFrom || !customTo}
        className="mt-2 h-8 w-full cursor-pointer rounded bg-gray-900 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Aplicar
      </button>
    </div>
  )
}

function CreditCardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="6" y1="15" x2="10" y2="15" />
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
