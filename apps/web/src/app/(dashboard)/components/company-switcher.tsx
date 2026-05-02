'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AuthUser } from '@/lib/auth'

/**
 * UX-7 #3: company switcher inline no header.
 * Karlão troca PontualTech ↔ Aqualife ↔ Imprimitech sem ir pra
 * /select-company (5-10 cliques antes).
 *
 * Renderiza só se usuário tem múltiplas empresas. Caso 1 empresa,
 * mostra nome estático sem dropdown.
 */
type Company = { id: string; name: string; slug: string; logo: string | null }

export function CompanySwitcher({ user }: { user: AuthUser }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/auth/companies')
      .then(r => r.ok ? r.json() : null)
      .then(j => setCompanies(j?.data || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function switchTo(companyId: string) {
    if (companyId === user.companyId) {
      setOpen(false)
      return
    }
    setSwitching(companyId)
    try {
      const res = await fetch('/api/auth/switch-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      if (!res.ok) throw new Error('Falha ao trocar de empresa')
      const target = companies.find(c => c.id === companyId)
      toast.success(`Trocado para ${target?.name || 'nova empresa'}`)
      router.push('/')
      router.refresh()
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao trocar empresa')
    } finally {
      setSwitching(null)
      setOpen(false)
    }
  }

  // Se carregando ou só 1 empresa: nada visível (não polui header)
  if (companies.length <= 1) {
    return null
  }

  const current = companies.find(c => c.id === user.companyId) || companies[0]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-md border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-700 min-h-[36px]"
        aria-haspopup="true"
        aria-expanded={open ? 'true' : 'false'}
        title="Trocar de empresa"
      >
        <Building2 className="h-4 w-4 text-gray-400" />
        <span className="hidden md:inline truncate max-w-[140px] font-medium">{current.name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-64 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-zinc-800 text-[10px] font-semibold uppercase text-gray-500">
            Suas empresas ({companies.length})
          </div>
          <div className="max-h-72 overflow-y-auto">
            {companies.map((c) => {
              const isCurrent = c.id === user.companyId
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => switchTo(c.id)}
                  disabled={switching != null}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-50 ${isCurrent ? 'bg-blue-50 dark:bg-blue-950' : ''}`}
                >
                  {c.logo ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={c.logo} alt="" className="w-7 h-7 rounded object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0 text-left">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{c.name}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{c.slug}</p>
                  </div>
                  {switching === c.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600 flex-shrink-0" />
                  ) : isCurrent ? (
                    <Check className="h-4 w-4 text-blue-600 flex-shrink-0" />
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
