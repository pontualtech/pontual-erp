'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { AuthUser } from '@/lib/auth'
import { Search, ChevronRight, LogOut, User, Settings } from 'lucide-react'
import Link from 'next/link'
import { NotificationBell } from './notification-bell'
import { MissedCallsBell } from '@/components/voip/MissedCallsBell'
import { CommandPalette } from './command-palette'
import { CompanySwitcher } from './company-switcher'

const breadcrumbMap: Record<string, string> = {
  os: 'Ordens de Servico',
  clientes: 'Clientes',
  produtos: 'Produtos',
  financeiro: 'Financeiro',
  fiscal: 'Fiscal',
  config: 'Configuracoes',
  perfil: 'Perfil',
  novo: 'Nova',
}

function Breadcrumb() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  // Hide UUID segments (e.g. OS detail pages — the OS number is shown in the page header)
  const isUuid = (s: string) => /^[0-9a-f]{8}-/.test(s)
  const visibleSegments = segments.filter(s => !isUuid(s))

  // Build href for each breadcrumb segment
  function buildHref(index: number): string {
    // Map visible segments back to actual path segments
    const pathSegments = segments.slice(0, segments.indexOf(visibleSegments[index]) + 1)
    return '/' + pathSegments.join('/')
  }

  const isLast = (i: number) => i === visibleSegments.length - 1

  return (
    <nav className="flex items-center gap-1 text-sm text-gray-500">
      <Link href="/" className="font-medium text-gray-700 hover:text-blue-600 transition-colors">
        Inicio
      </Link>
      {visibleSegments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3" />
          {isLast(i) ? (
            <span className="text-gray-700 font-medium">
              {breadcrumbMap[seg] ?? seg}
            </span>
          ) : (
            <Link href={buildHref(i)} className="hover:text-blue-600 transition-colors">
              {breadcrumbMap[seg] ?? seg}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}

export function Header({ user }: { user: AuthUser }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // UX-5 #1: Cmd+K abre command palette (não mais simple search)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Close menu on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <header className="flex h-14 items-center justify-between border-b bg-white dark:bg-gray-800 dark:border-gray-700 px-4 lg:px-6">
      <div className="pl-10 lg:pl-0">
        <Breadcrumb />
      </div>

      <div className="flex items-center gap-3">
        {/* UX-7 #3: Company switcher inline (multi-tenant) */}
        <CompanySwitcher user={user} />
        {/* Search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 rounded-md border bg-gray-50 px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-100"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Buscar...</span>
          <kbd className="hidden rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-500 sm:inline">
            Ctrl+K
          </kbd>
        </button>

        {/* Missed calls (24h) */}
        <MissedCallsBell />

        {/* Notifications */}
        <NotificationBell />

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700 hover:bg-blue-200"
          >
            {user.name.charAt(0).toUpperCase()}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-10 z-50 w-48 rounded-md border bg-white py-1 shadow-lg">
              <div className="border-b px-3 py-2">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-gray-500">{user.email}</p>
              </div>
              <button
                onClick={() => { setMenuOpen(false); router.push('/perfil') }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <User className="h-4 w-4" /> Perfil
              </button>
              <button
                onClick={() => { setMenuOpen(false); router.push('/config') }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Settings className="h-4 w-4" /> Configuracoes
              </button>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </div>
          )}
        </div>
      </div>

      {/* UX-5 #1: Command palette via cmdk lib (substitui modal antigo de busca) */}
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  )
}
