'use client'

import Link from 'next/link'
import { Home, FileText, MessageCircle, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Portal Bottom Tab Bar — Roberto #16 fix (Sprint UX-16, 2026-05-23)
 *
 * Bottom-tab-bar fixa apenas em mobile (sm:hidden).
 * Pattern: iFood, Magalu, Uber.
 * Ícones grandes (~28px) + labels (text-xs).
 * Touch targets: 56px altura por item (acima do mínimo HIG 44px).
 *
 * IMPORTANTE: páginas que usam essa barra devem ter padding-bottom suficiente
 * (pb-20 ou maior) no main container pra evitar conteúdo escondido.
 */

interface Props {
  slug: string
  current: 'home' | 'os' | 'tickets' | 'financeiro'
}

export function PortalBottomTabBar({ slug, current }: Props) {
  const tabs = [
    { key: 'home',       label: 'Início',     href: `/portal/${slug}`,            icon: Home },
    { key: 'os',         label: 'Minhas OS',  href: `/portal/${slug}/os`,         icon: FileText },
    { key: 'tickets',    label: 'Tickets',    href: `/portal/${slug}/tickets`,    icon: MessageCircle },
    { key: 'financeiro', label: 'Financeiro', href: `/portal/${slug}/financeiro`, icon: Wallet },
  ] as const

  return (
    <nav
      className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-zinc-800 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]"
      role="navigation"
      aria-label="Navegação principal"
    >
      <div className="flex items-stretch">
        {tabs.map(t => {
          const Icon = t.icon
          const active = t.key === current
          return (
            <Link
              key={t.key}
              href={t.href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[56px] transition-colors',
                active
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className={cn('h-5 w-5', active && 'stroke-[2.5]')} aria-hidden="true" />
              <span className="text-[11px] font-medium">{t.label}</span>
            </Link>
          )
        })}
      </div>
      {/* Safe-area iOS (notch/home indicator) */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  )
}
