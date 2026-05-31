'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'

interface Props {
  receivableOverdueCents: number
  receivableOverdueCount: number
  payableOverdueCents: number
  payableOverdueCount: number
  loading?: boolean
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

// Banner promovido — chama atenção pra ação prioritária (cobrar / pagar)
// só renderiza se há algo a fazer; caso contrário, vira card "tudo em dia".
export function OverdueBanner({
  receivableOverdueCents,
  receivableOverdueCount,
  payableOverdueCents,
  payableOverdueCount,
  loading,
}: Props) {
  if (loading) {
    return <div className="h-20 animate-pulse rounded-xl border border-gray-200 bg-white" />
  }

  const nothing = receivableOverdueCount === 0 && payableOverdueCount === 0
  if (nothing) {
    return (
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-5 py-4">
        <div className="flex items-center gap-3">
          <svg className="h-5 w-5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <p className="text-sm text-emerald-800">
            <span className="font-semibold">Tudo em dia.</span> Nenhuma cobrança ou pagamento vencido.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {receivableOverdueCount > 0 && (
        <ActionTile
          tone="amber"
          icon={AlertTriangle}
          label="A receber vencidos"
          amount={formatBRL(receivableOverdueCents)}
          countText={`${receivableOverdueCount} ${receivableOverdueCount === 1 ? 'título' : 'títulos'}`}
          href="/financeiro/contas-receber?status=vencidos"
          cta="Cobrar agora"
        />
      )}
      {payableOverdueCount > 0 && (
        <ActionTile
          tone="orange"
          icon={AlertTriangle}
          label="A pagar vencidos"
          amount={formatBRL(payableOverdueCents)}
          countText={`${payableOverdueCount} ${payableOverdueCount === 1 ? 'título' : 'títulos'}`}
          href="/financeiro/contas-pagar?status=vencidos"
          cta="Pagar agora"
        />
      )}
    </div>
  )
}

function ActionTile({
  tone,
  icon: Icon,
  label,
  amount,
  countText,
  href,
  cta,
}: {
  tone: 'amber' | 'orange'
  icon: typeof AlertTriangle
  label: string
  amount: string
  countText: string
  href: string
  cta: string
}) {
  const toneClass = tone === 'amber'
    ? { ring: 'ring-amber-200', bg: 'bg-amber-50/60', iconBg: 'bg-amber-100', iconText: 'text-amber-700', linkText: 'text-amber-800 hover:text-amber-900' }
    : { ring: 'ring-orange-200', bg: 'bg-orange-50/60', iconBg: 'bg-orange-100', iconText: 'text-orange-700', linkText: 'text-orange-800 hover:text-orange-900' }

  return (
    <Link href={href} className={`group flex cursor-pointer items-center gap-4 rounded-xl bg-white p-4 ring-1 ring-inset ${toneClass.ring} transition-all hover:shadow-sm`}>
      <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-lg ${toneClass.iconBg}`}>
        <Icon className={`h-5 w-5 ${toneClass.iconText}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-semibold text-gray-900 tabular-nums">{amount}</p>
        <p className="text-[11px] text-gray-500 tabular-nums">{countText}</p>
      </div>
      <span className={`inline-flex flex-none items-center gap-1 text-sm font-medium transition-colors ${toneClass.linkText}`}>
        {cta}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
