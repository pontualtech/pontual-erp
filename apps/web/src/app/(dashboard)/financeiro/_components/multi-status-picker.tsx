'use client'

import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StatusOption {
  value: string
  label: string
  // Cor opcional pra dot indicador (tailwind class, ex: 'bg-emerald-500')
  color?: string
}

interface Props {
  value: string // CSV (ex: "PENDENTE,VENCIDO") ou "" pra todos
  onChange: (csv: string) => void
  options: StatusOption[]
  label?: string
  // ID pra <label htmlFor>
  id?: string
  // Cor de accent (focus ring, badge). Default emerald (combina com receber).
  accent?: 'emerald' | 'blue' | 'red'
}

const accentClasses = {
  emerald: { active: 'border-emerald-300 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', ring: 'focus-visible:ring-emerald-500' },
  blue:    { active: 'border-blue-300 bg-blue-50 text-blue-700',          dot: 'bg-blue-500',    ring: 'focus-visible:ring-blue-500' },
  red:     { active: 'border-red-300 bg-red-50 text-red-700',             dot: 'bg-red-500',     ring: 'focus-visible:ring-red-500' },
}

// Multi-select de status. Valor mantido como CSV string pra integrar com
// APIs que já aceitam ?status=A,B,C (Wave T 2026-05-24). UI mostra checkboxes
// dentro de Popover, com botão sumarizando "N selecionados" ou nome único.
export function MultiStatusPicker({ value, onChange, options, label = 'Status', id, accent = 'emerald' }: Props) {
  const selected = new Set(value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [])
  const a = accentClasses[accent]
  const count = selected.size

  const toggle = (v: string) => {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange(Array.from(next).join(','))
  }

  const buttonLabel =
    count === 0 ? 'Todos' :
    count === 1 ? options.find((o) => selected.has(o.value))?.label ?? Array.from(selected)[0] :
    `${count} selecionados`

  return (
    <div className="min-w-[160px]">
      {label && <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-500">{label}</label>}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            className={cn(
              'flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
              count > 0 ? a.active : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
              a.ring,
            )}
            aria-label={`${label}: ${buttonLabel}`}
          >
            <span className="truncate">{buttonLabel}</span>
            <div className="flex flex-none items-center gap-1.5">
              {count > 0 && (
                <span className={cn('flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white', a.dot)}>
                  {count}
                </span>
              )}
              <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
            </div>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 w-56 rounded-md border border-gray-200 bg-white p-1.5 shadow-lg"
          >
            {count > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => onChange('')}
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  Limpar seleção
                </button>
                <div className="my-1 h-px bg-gray-100" />
              </>
            )}
            <div className="max-h-72 overflow-y-auto">
              {options.map((opt) => {
                const isSel = selected.has(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2.5 py-2 text-sm text-left transition-colors hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'flex h-4 w-4 flex-none items-center justify-center rounded border transition-colors',
                          isSel ? `border-transparent ${a.dot}` : 'border-gray-300 bg-white',
                        )}
                        aria-hidden="true"
                      >
                        {isSel && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                      </span>
                      {opt.color && <span className={cn('h-2 w-2 flex-none rounded-full', opt.color)} aria-hidden="true" />}
                      <span className={cn('text-gray-900', isSel && 'font-medium')}>{opt.label}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
