'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { AuthUser } from '@/lib/auth'
import { Search, ChevronRight, LogOut, User, Settings, Wrench, Users, Package, Loader2 } from 'lucide-react'
import { NotificationBell } from './notification-bell'

interface SearchResults {
  os: { id: string; os_number: number; equipment_type: string; status_name: string; customer_name: string }[]
  clientes: { id: string; legal_name: string; document_number: string | null; mobile: string | null }[]
  produtos: { id: string; name: string; sku: string | null; current_stock: number | null }[]
}

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

  return (
    <nav className="flex items-center gap-1 text-sm text-gray-500">
      <span className="font-medium text-gray-700">Inicio</span>
      {visibleSegments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3" />
          <span className={cn(i === visibleSegments.length - 1 && 'text-gray-700 font-medium')}>
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
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSearchResults(null)
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const json = await res.json()
      if (json.data) setSearchResults(json.data)
    } catch {
      // ignore
    } finally {
      setSearchLoading(false)
    }
  }, [])

  function handleSearchInput(value: string) {
    setSearchQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(value), 300)
  }

  function closeSearch() {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults(null)
    setSearchLoading(false)
  }

  function navigateTo(path: string) {
    closeSearch()
    router.push(path)
  }

  // Cmd+K shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(prev => !prev)
        setSearchQuery('')
        setSearchResults(null)
        setSearchLoading(false)
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

      {/* Search modal */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/30" onClick={closeSearch}>
          <div className="w-full max-w-lg rounded-lg border bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Search className="h-5 w-5 text-gray-400" />
              <input
                autoFocus
                value={searchQuery}
                onChange={e => handleSearchInput(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && closeSearch()}
                placeholder="Buscar OS, clientes, produtos..."
                className="flex-1 bg-transparent text-sm outline-none"
              />
              {searchLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {!searchResults && !searchLoading && (
                <div className="p-4 text-center text-sm text-gray-400">
                  Digite para buscar
                </div>
              )}
              {searchResults && (
                <>
                  {searchResults.os.length === 0 && searchResults.clientes.length === 0 && searchResults.produtos.length === 0 ? (
                    <div className="p-4 text-center text-sm text-gray-400">
                      Nenhum resultado encontrado
                    </div>
                  ) : (
                    <div className="py-2">
                      {searchResults.os.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase">
                            <Wrench className="h-3.5 w-3.5" /> Ordens de Servico
                          </div>
                          {searchResults.os.map(o => (
                            <button
                              key={o.id}
                              onClick={() => navigateTo(`/os/${o.id}`)}
                              className="flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-gray-50"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-blue-600">#{o.os_number}</span>
                                <span className="text-gray-700">{o.equipment_type}</span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                <span>{o.customer_name}</span>
                                <span className="rounded bg-gray-100 px-1.5 py-0.5">{o.status_name}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.clientes.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase">
                            <Users className="h-3.5 w-3.5" /> Clientes
                          </div>
                          {searchResults.clientes.map(c => (
                            <button
                              key={c.id}
                              onClick={() => navigateTo(`/clientes/${c.id}`)}
                              className="flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-gray-50"
                            >
                              <span className="font-medium text-gray-700">{c.legal_name}</span>
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                {c.document_number && <span>{c.document_number}</span>}
                                {c.mobile && <span>{c.mobile}</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.produtos.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase">
                            <Package className="h-3.5 w-3.5" /> Produtos
                          </div>
                          {searchResults.produtos.map(p => (
                            <button
                              key={p.id}
                              onClick={() => navigateTo(`/produtos/${p.id}`)}
                              className="flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-gray-50"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-700">{p.name}</span>
                                {p.sku && <span className="text-xs text-gray-400">{p.sku}</span>}
                              </div>
                              <span className="text-xs text-gray-500">
                                Estoque: {p.current_stock ?? 0}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
