'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/use-auth'
import type { AuthUser } from '@/lib/auth'
import {
  ClipboardList, Users, Package, DollarSign, FileText,
  Settings, LayoutDashboard, Menu, X, ChevronDown, MessageSquare, MessageCircle, Phone, Truck,
  Building2, ShoppingCart, BarChart3,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  module?: string
  children?: { label: string; href: string; icon: React.ElementType }[]
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
      { label: 'WhatsApp', href: '/integracoes/chatwoot', icon: Phone, module: 'core' },
      { label: 'Logistica', href: '/logistica', icon: Truck, module: 'core' },
    ],
  },
  {
    title: 'Estoque',
    items: [
      {
        label: 'Produtos',
        href: '/produtos',
        icon: Package,
        module: 'estoque',
        children: [
          { label: 'Fornecedores', href: '/estoque/fornecedores', icon: Building2 },
          { label: 'Compras', href: '/estoque/compras', icon: ShoppingCart },
          { label: 'Relatórios', href: '/estoque/relatorios', icon: BarChart3 },
        ],
      },
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

export function Sidebar({ user }: { user: AuthUser }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const { hasPermission } = useAuth()

  const filteredGroups = navGroups
    .map(g => ({
      ...g,
      items: g.items.filter(i => {
        if (!i.module) return true
        return hasPermission(i.module, 'view')
      }),
    }))
    .filter(g => g.items.length > 0)

  function toggleExpand(href: string) {
    setExpandedItems(prev => {
      const n = new Set(prev)
      n.has(href) ? n.delete(href) : n.add(href)
      return n
    })
  }

  // Auto-expand if on a child route
  function isChildActive(item: NavItem) {
    return item.children?.some(c => pathname === c.href || pathname.startsWith(c.href + '/'))
  }

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
                const active = item.href === '/'
                  ? pathname === '/'
                  : pathname === item.href || pathname.startsWith(item.href + '/')
                const hasChildren = item.children && item.children.length > 0
                const isExpanded = expandedItems.has(item.href) || isChildActive(item)

                return (
                  <li key={item.href}>
                    <div className="flex items-center">
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'flex flex-1 items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                      {hasChildren && (
                        <button
                          type="button"
                          title="Expandir submenu"
                          onClick={() => toggleExpand(item.href)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
                        </button>
                      )}
                    </div>
                    {/* Children sub-links */}
                    {hasChildren && isExpanded && (
                      <ul className="ml-6 mt-0.5 space-y-0.5 border-l border-gray-200 dark:border-gray-700 pl-2">
                        {item.children!.map(child => {
                          const ChildIcon = child.icon
                          const childActive = pathname === child.href || pathname.startsWith(child.href + '/')
                          return (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                onClick={() => setOpen(false)}
                                className={cn(
                                  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                                  childActive
                                    ? 'text-blue-700 font-medium dark:text-blue-400'
                                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                                )}
                              >
                                <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                                {child.label}
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
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
        type="button"
        title="Menu"
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
