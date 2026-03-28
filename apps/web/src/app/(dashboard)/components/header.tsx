'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { AuthUser } from '@/lib/auth'
import { Search, ChevronRight, LogOut, User, Settings } from 'lucide-react'

const breadcrumbMap: Record<string, string> = {
  os: 'Ordens de Servico',
  clientes: 'Clientes',
  produtos: 'Produtos',
  financeiro: 'Financeiro',
  fiscal: 'Fiscal',
  config: 'Configuracoes',
  novo: 'Nova',
}

function Breadcrumb() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  return (
    <nav className="flex items-center gap-1 text-sm text-gray-500">
      <span className="font-medium text-gray-700">Inicio</span>
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3" />
          <span className={cn(i === segments.length - 1 && 'text-gray-700 font-medium')}>
            {breadcrumbMap[seg] ?? seg}
          </span>
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

  // Cmd+K shortcut
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
              <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <User className="h-4 w-4" /> Perfil
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
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

      {/* Search modal (simplified) */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/30" onClick={() => setSearchOpen(false)}>
          <div className="w-full max-w-lg rounded-lg border bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Search className="h-5 w-5 text-gray-400" />
              <input
                autoFocus
                placeholder="Buscar OS, clientes, produtos..."
                className="flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <div className="p-4 text-center text-sm text-gray-400">
              Digite para buscar
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
