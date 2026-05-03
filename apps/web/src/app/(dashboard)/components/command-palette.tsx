'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import {
  Search, Wrench, Users, Package, Plus, BarChart3, DollarSign,
  Truck, Settings, FileText, Phone, MessageCircle, Home, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

/**
 * UX-5 #1: Command palette de ações (não só busca).
 *
 * Estrutura:
 *  - Sem query → mostra "Ações rápidas" + "Ir para..." (descoberta)
 *  - Com query → busca server-side em OS/clientes/produtos + ações filtradas
 *
 * Atalhos:
 *  - Cmd+K abre/fecha
 *  - ↑↓ navega
 *  - Enter executa
 *  - Esc fecha
 */
type SearchOS = { id: string; os_number: number; equipment_type: string; customer_name: string; status_name: string }
type SearchCustomer = { id: string; legal_name: string; document_number: string | null; mobile: string | null }
type SearchProduct = { id: string; name: string; sku: string | null; current_stock: number | null }
type SearchResults = { os: SearchOS[]; clientes: SearchCustomer[]; produtos: SearchProduct[] }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)

  // Body scroll lock + reset state when closed
  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults(null)
      setLoading(false)
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Server search (debounced 300ms)
  useEffect(() => {
    if (!open) return
    if (query.trim().length < 2) {
      setResults(null)
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        if (res.ok) {
          const data = await res.json()
          setResults(data.data || null)
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') console.error('search error', e)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [query, open])

  const navigateTo = useCallback((path: string) => {
    onClose()
    router.push(path)
  }, [onClose, router])

  const runAction = useCallback((label: string, fn: () => void | Promise<void>) => {
    onClose()
    Promise.resolve(fn()).catch((err) => toast.error(`Erro em "${label}": ${err?.message || 'desconhecido'}`))
  }, [onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paleta de comandos"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40"
      onClick={onClose}
    >
      <Command
        label="Paleta de comandos"
        shouldFilter={false /* filtragem é nossa, não da lib */}
        loop
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border bg-white dark:bg-zinc-900 dark:border-zinc-700 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-zinc-700 px-4 py-3">
          <Search className="h-5 w-5 text-gray-400" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Buscar OS, cliente, produto · ou digite uma ação..."
            className="flex-1 bg-transparent text-sm outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
            autoFocus
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          <kbd className="hidden sm:inline rounded bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-gray-500">ESC</kbd>
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto p-1">
          <Command.Empty className="py-6 text-center text-sm text-gray-400">
            Nenhum resultado para &quot;{query}&quot;
          </Command.Empty>

          {/* UX-11 #10: Ações rápidas SEMPRE visíveis (com filtro local por synonyms).
              Antes só apareciam com query vazia — usuário digitava "Criar OS" e não achava. */}
          {(() => {
            const q = query.toLowerCase().trim()
            // Helper: retorna se o item bate com a query via synonyms
            const matches = (synonyms: string[]) => !q || synonyms.some(s => s.toLowerCase().includes(q))
            return (
              <>
                <Command.Group heading="Ações rápidas" className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {matches(['Nova OS', 'Criar OS', 'Abrir OS', 'Novo serviço', 'Nova ordem']) && (
                    <PaletteItem icon={Plus} label="Nova OS" shortcut="N" onSelect={() => runAction('Nova OS', () => router.push('/os/novo'))} />
                  )}
                  {matches(['Novo cliente', 'Cadastrar cliente', 'Adicionar cliente', 'Criar cliente']) && (
                    <PaletteItem icon={Plus} label="Novo cliente" onSelect={() => runAction('Novo cliente', () => router.push('/clientes/novo'))} />
                  )}
                  {matches(['Novo produto', 'Cadastrar produto', 'Adicionar produto', 'Criar produto']) && (
                    <PaletteItem icon={Plus} label="Novo produto" onSelect={() => runAction('Novo produto', () => router.push('/produtos/novo'))} />
                  )}
                </Command.Group>

                <Command.Group heading="Ir para..." className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {matches(['Dashboard', 'Inicio', 'Home', 'Painel']) && <PaletteItem icon={Home} label="Dashboard" shortcut="G D" onSelect={() => navigateTo('/')} />}
                  {matches(['Ordens de Serviço', 'OS', 'Lista de OS', 'Servicos']) && <PaletteItem icon={Wrench} label="Ordens de Serviço" shortcut="G O" onSelect={() => navigateTo('/os')} />}
                  {matches(['Clientes', 'Customers']) && <PaletteItem icon={Users} label="Clientes" shortcut="G C" onSelect={() => navigateTo('/clientes')} />}
                  {matches(['Financeiro', 'Caixa', 'AR', 'AP', 'Contas']) && <PaletteItem icon={DollarSign} label="Financeiro" shortcut="G F" onSelect={() => navigateTo('/financeiro')} />}
                  {matches(['Logística', 'Logistica', 'Rotas', 'Motorista', 'Entrega']) && <PaletteItem icon={Truck} label="Logística" onSelect={() => navigateTo('/logistica')} />}
                  {matches(['Produtos', 'Estoque', 'Pecas']) && <PaletteItem icon={Package} label="Produtos / Estoque" onSelect={() => navigateTo('/produtos')} />}
                  {matches(['Fiscal', 'NFSe', 'NF-e', 'Notas']) && <PaletteItem icon={FileText} label="Fiscal (NFS-e)" onSelect={() => navigateTo('/fiscal')} />}
                  {matches(['Relatórios BI', 'Relatorios', 'BI', 'Margem', 'Analytics']) && <PaletteItem icon={BarChart3} label="Relatórios BI" onSelect={() => navigateTo('/relatorios-bi')} />}
                  {matches(['VoIP', 'Chamadas', 'Telefonia', 'Ligar']) && <PaletteItem icon={Phone} label="VoIP / Chamadas" onSelect={() => navigateTo('/voip')} />}
                  {matches(['WhatsApp', 'Chat', 'Mensagens']) && <PaletteItem icon={MessageCircle} label="WhatsApp / Chat" onSelect={() => navigateTo('/chat')} />}
                  {matches(['Configurações', 'Configuracoes', 'Settings', 'Ajustes']) && <PaletteItem icon={Settings} label="Configurações" onSelect={() => navigateTo('/configuracoes')} />}
                </Command.Group>
              </>
            )
          })()}

          {/* Resultados da busca quando query >= 2 chars */}
          {results && (
            <>
              {results.os.length > 0 && (
                <Command.Group heading="Ordens de Serviço" className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {results.os.map((o) => (
                    <Command.Item
                      key={`os-${o.id}`}
                      value={`os ${o.os_number} ${o.customer_name} ${o.equipment_type}`}
                      onSelect={() => navigateTo(`/os/${o.id}`)}
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer aria-selected:bg-blue-50 dark:aria-selected:bg-blue-950"
                    >
                      <Wrench className="h-4 w-4 text-blue-600 flex-shrink-0" />
                      <span className="font-medium text-blue-700 dark:text-blue-400">#{o.os_number}</span>
                      <span className="text-gray-700 dark:text-gray-300 truncate">{o.equipment_type}</span>
                      <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 truncate">{o.customer_name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {results.clientes.length > 0 && (
                <Command.Group heading="Clientes" className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {results.clientes.map((c) => (
                    <Command.Item
                      key={`c-${c.id}`}
                      value={`cliente ${c.legal_name} ${c.document_number || ''} ${c.mobile || ''}`}
                      onSelect={() => navigateTo(`/clientes/${c.id}`)}
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer aria-selected:bg-blue-50 dark:aria-selected:bg-blue-950"
                    >
                      <Users className="h-4 w-4 text-purple-600 flex-shrink-0" />
                      <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{c.legal_name}</span>
                      <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{c.document_number || c.mobile || ''}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {results.produtos.length > 0 && (
                <Command.Group heading="Produtos" className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {results.produtos.map((p) => (
                    <Command.Item
                      key={`p-${p.id}`}
                      value={`produto ${p.name} ${p.sku || ''}`}
                      onSelect={() => navigateTo(`/produtos/${p.id}`)}
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer aria-selected:bg-blue-50 dark:aria-selected:bg-blue-950"
                    >
                      <Package className="h-4 w-4 text-amber-600 flex-shrink-0" />
                      <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{p.name}</span>
                      {p.sku && <span className="text-xs text-gray-400">{p.sku}</span>}
                      <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">Estoque: {p.current_stock ?? 0}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </>
          )}
        </Command.List>

        <div className="border-t border-gray-100 dark:border-zinc-800 px-3 py-2 text-[10px] text-gray-400 flex items-center justify-between">
          <span>↑↓ navegar · Enter executar · ESC fechar</span>
          <span className="hidden sm:inline">Pressione <kbd className="rounded bg-gray-100 dark:bg-zinc-800 px-1">?</kbd> para atalhos</span>
        </div>
      </Command>
    </div>
  )
}

function PaletteItem({
  icon: Icon, label, shortcut, onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  onSelect: () => void
}) {
  return (
    <Command.Item
      value={label.toLowerCase()}
      onSelect={onSelect}
      className="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer aria-selected:bg-blue-50 dark:aria-selected:bg-blue-950 text-gray-700 dark:text-gray-300"
    >
      <Icon className="h-4 w-4 text-gray-500 flex-shrink-0" />
      <span className="flex-1">{label}</span>
      {shortcut && (
        <kbd className="rounded bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-gray-500 font-mono">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  )
}
