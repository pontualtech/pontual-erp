'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { AuthUser } from '@/lib/auth'
import {
  ClipboardList, Users, Package, DollarSign, FileText,
  Settings, LayoutDashboard, Menu, X, ChevronDown, MessageSquare, MessageCircle,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  module?: string
}

const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: 'Geral',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Operacional',
    items: [
      { label: 'Ordens de Servico', href: '/os', icon: ClipboardList, module: 'os' },
      { label: 'Clientes', href: '/clientes', icon: Users, module: 'clientes' },
      { label: 'Tickets', href: '/tickets', icon: MessageSquare, module: 'core' },
      { label: 'Chat', href: '/chat', icon: MessageCircle, module: 'core' },
    ],
  },
  {
    title: 'Estoque',
    items: [
      { label: 'Produtos', href: '/produtos', icon: Package, module: 'estoque' },
    ],
  },
  {
    title: 'Financeiro',
    items: [
      { label: 'Financeiro', href: '/financeiro', icon: DollarSign, module: 'financeiro' },
      { label: 'Fiscal', href: '/fiscal', icon: FileText, module: 'fiscal' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { label: 'Configuracoes', href: '/config', icon: Settings, module: 'config' },
    ],
  },
]

const ADMIN_ROLES = ['admin', 'owner']

function canAccess(roleName: string, module?: string) {
  if (!module) return true
  if (ADMIN_ROLES.includes(roleName)) return true
  // Non-admin: hide config
  if (module === 'config') return false
  return true
}

export function Sidebar({ user }: { user: AuthUser }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const filteredGroups = navGroups
    .map(g => ({
      ...g,
      items: g.items.filter(i => canAccess(user.roleName, i.module)),
    }))
    .filter(g => g.items.length > 0)

  const content = (
    <div className="flex h-full flex-col">
      {/* Company name */}
      <div className="flex h-14 items-center border-b dark:border-gray-700 px-4">
        <span className="text-lg font-bold text-blue-700 dark:text-blue-400">PontualERP</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {filteredGroups.map(group => (
          <div key={group.title}>
            <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const Icon = item.icon
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User info */}
      <div className="border-t dark:border-gray-700 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900 text-sm font-bold text-blue-700 dark:text-blue-400">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="overflow-hidden">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{user.name}</p>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{user.roleName}</p>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="fixed left-4 top-3 z-50 rounded-md p-1.5 text-gray-600 hover:bg-gray-100 lg:hidden"
        onClick={() => setOpen(!open)}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-60 border-r bg-white dark:bg-gray-800 dark:border-gray-700 transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {content}
      </aside>
    </>
  )
}
