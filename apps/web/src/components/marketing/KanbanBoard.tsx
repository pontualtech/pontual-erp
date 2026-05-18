'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Loader2 } from 'lucide-react'
import { STAGES, type StageKey } from '@/lib/marketing/stages'
import { KanbanColumn } from './KanbanColumn'
import { KanbanCard, type KanbanContact } from './KanbanCard'
import { BatchToolbar } from './BatchToolbar'
import { toast } from 'sonner'

interface Props {
  /** Filtros aplicados — passados nos query params da API */
  filters: {
    search?: string
    segment?: string
    unsubscribed?: string
    onlyBounced?: boolean
    /** Tags em AND (CSV) — mescladas com stage:X que o board adiciona */
    tagsAll?: string
    /** Tags em OR (CSV) — hasSome no backend */
    tagsAny?: string
    /** Tags em NOT (CSV) — NOT hasSome no backend */
    tagsNot?: string
  }
}

interface ColumnData {
  contacts: KanbanContact[]
  total: number
  loading: boolean
}

const COLUMN_LIMIT = 50

export function KanbanBoard({ filters }: Props) {
  const router = useRouter()
  const [columns, setColumns] = useState<Record<StageKey, ColumnData>>(() => {
    const init: any = {}
    STAGES.forEach(s => { init[s.key] = { contacts: [], total: 0, loading: true } })
    return init
  })
  const [activeCard, setActiveCard] = useState<{ contact: KanbanContact; stage: StageKey } | null>(null)
  const [initialLoad, setInitialLoad] = useState(true)

  /** ids de cards selecionados (multi-select pra ações em lote). Set pra O(1) lookup. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  /** último id clicado — base do range select com shift */
  const [lastClickedId, setLastClickedId] = useState<string | null>(null)

  /** Lista flat de TODOS contatos visíveis (em ordem de colunas) — usada pra range select */
  const flatContacts = useMemo(() => {
    return STAGES.flatMap(s => columns[s.key]?.contacts || [])
  }, [columns])

  const handleToggleSelect = useCallback((id: string, modifiers: { shift: boolean; meta: boolean }) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      // Shift-click: seleciona range entre lastClickedId e id (inclusive)
      if (modifiers.shift && lastClickedId && lastClickedId !== id) {
        const idxA = flatContacts.findIndex(c => c.id === lastClickedId)
        const idxB = flatContacts.findIndex(c => c.id === id)
        if (idxA !== -1 && idxB !== -1) {
          const [from, to] = idxA < idxB ? [idxA, idxB] : [idxB, idxA]
          flatContacts.slice(from, to + 1).forEach(c => next.add(c.id))
          return next
        }
      }
      // Toggle simples
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setLastClickedId(id)
  }, [lastClickedId, flatContacts])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setLastClickedId(null)
  }, [])

  /** Move N contatos selecionados pra uma fase (1..5) via batch endpoint */
  const batchMoveToStage = useCallback(async (toStage: StageKey) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const stageDef = STAGES.find(s => s.key === toStage)
    if (!stageDef) return
    try {
      const r = await fetch('/api/marketing/contatos/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_stage', ids, stage: toStage }),
      })
      if (!r.ok) throw new Error('batch failed')
      toast.success(`${ids.length} ${ids.length === 1 ? 'contato movido' : 'contatos movidos'} → ${stageDef.label}`)
      clearSelection()
      Promise.all(STAGES.map(s => fetchColumn(s.key)))
    } catch {
      toast.error('Erro ao mover contatos.')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, clearSelection])

  // Atalhos de teclado: Esc limpa seleção; e abre detalhe; 1..5 movem fase
  useEffect(() => {
    if (selectedIds.size === 0) return
    function onKey(ev: KeyboardEvent) {
      // Ignora se estiver digitando em campo editável
      const t = ev.target as HTMLElement | null
      if (t?.matches?.('input,textarea,[contenteditable=true]')) return
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return

      if (ev.key === 'Escape') { clearSelection(); return }

      if (ev.key === 'e') {
        const firstId = Array.from(selectedIds)[0]
        if (firstId) {
          ev.preventDefault()
          router.push(`/marketing/contatos/${firstId}`)
        }
        return
      }

      // 1..5 → STAGES[0..4]
      const n = parseInt(ev.key, 10)
      if (!Number.isNaN(n) && n >= 1 && n <= STAGES.length) {
        ev.preventDefault()
        batchMoveToStage(STAGES[n - 1].key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, clearSelection, router, batchMoveToStage])

  // Sensor com distância mínima de 5px — evita acionar drag em cliques curtos
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Constrói URL params para cada coluna
  function buildParams(stage: StageKey): URLSearchParams {
    const p = new URLSearchParams()
    p.set('limit', String(COLUMN_LIMIT))
    if (filters.search) p.set('search', filters.search)
    const tags: string[] = [`stage:${stage}`]
    if (filters.segment) tags.push(`segment:${filters.segment}`)
    if (filters.tagsAll) tags.push(...filters.tagsAll.split(',').filter(Boolean))
    p.set('tags', tags.join(','))
    if (filters.tagsAny) p.set('tagsAny', filters.tagsAny)
    if (filters.tagsNot) p.set('tagsNot', filters.tagsNot)
    if (filters.unsubscribed) p.set('unsubscribed', filters.unsubscribed)
    if (filters.onlyBounced) p.set('onlyBounced', '1')
    return p
  }

  async function fetchColumn(stage: StageKey) {
    setColumns(prev => ({ ...prev, [stage]: { ...prev[stage], loading: true } }))
    try {
      const r = await fetch(`/api/marketing/contatos?${buildParams(stage).toString()}`)
      if (r.ok) {
        const j = await r.json()
        setColumns(prev => ({
          ...prev,
          [stage]: { contacts: j.data || [], total: j.total || 0, loading: false },
        }))
      } else {
        setColumns(prev => ({ ...prev, [stage]: { ...prev[stage], loading: false } }))
      }
    } catch {
      setColumns(prev => ({ ...prev, [stage]: { ...prev[stage], loading: false } }))
    }
  }

  // Carrega TODAS as colunas em paralelo no mount (e quando filtros mudam)
  useEffect(() => {
    Promise.all(STAGES.map(s => fetchColumn(s.key))).then(() => setInitialLoad(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.segment, filters.unsubscribed, filters.onlyBounced, filters.tagsAll, filters.tagsAny, filters.tagsNot])

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { contact: KanbanContact; stage: StageKey }
    setActiveCard({ contact: data.contact, stage: data.stage })
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveCard(null)
    if (!over) return

    const fromStage = active.data.current?.stage as StageKey
    const toStage = over.id as StageKey
    if (!fromStage || !toStage || fromStage === toStage) return

    const contact = active.data.current?.contact as KanbanContact
    if (!contact) return

    // Optimistic update: remove da coluna origem, adiciona na destino
    setColumns(prev => {
      const fromContacts = prev[fromStage].contacts.filter(c => c.id !== contact.id)
      const toContacts = [
        { ...contact, tags: [...contact.tags.filter(t => !t.startsWith('stage:')), `stage:${toStage}`] },
        ...prev[toStage].contacts,
      ].slice(0, COLUMN_LIMIT)
      return {
        ...prev,
        [fromStage]: { ...prev[fromStage], contacts: fromContacts, total: prev[fromStage].total - 1 },
        [toStage]: { ...prev[toStage], contacts: toContacts, total: prev[toStage].total + 1 },
      }
    })

    // PATCH API
    try {
      const r = await fetch(`/api/marketing/contatos/${contact.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: toStage }),
      })
      if (!r.ok) throw new Error('PATCH failed')
      toast.success(`Movido pra ${STAGES.find(s => s.key === toStage)?.label}`)
    } catch (e) {
      // Rollback em caso de erro
      toast.error('Erro ao mover. Recarregando.')
      Promise.all([fetchColumn(fromStage), fetchColumn(toStage)])
    }
  }

  if (initialLoad) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  /** Refresca todas as colunas — usado após ações em lote */
  const reloadAll = useCallback(() => {
    Promise.all(STAGES.map(s => fetchColumn(s.key)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ minHeight: '600px' }}>
        {STAGES.map(stage => (
          <KanbanColumn
            key={stage.key}
            stage={stage}
            contacts={columns[stage.key]?.contacts || []}
            total={columns[stage.key]?.total || 0}
            loading={columns[stage.key]?.loading}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        ))}
      </div>

      <DragOverlay>
        {activeCard ? <KanbanCard contact={activeCard.contact} stage={activeCard.stage} /> : null}
      </DragOverlay>

      <BatchToolbar
        selectedIds={selectedIds}
        onClear={clearSelection}
        onAction={() => { clearSelection(); reloadAll() }}
      />
    </DndContext>
  )
}
