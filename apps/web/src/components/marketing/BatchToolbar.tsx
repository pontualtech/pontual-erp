'use client'

/**
 * BatchToolbar — toolbar contextual flutuante exibida quando há cards
 * selecionados no Kanban. Permite ações em lote:
 *  - Mover pra fase X (set_stage)
 *  - Adicionar tag (add_tags)
 *  - Marcar como descadastrado (unsubscribe)
 *  - Apagar (delete)
 *
 * Chama PATCH /api/marketing/contatos/batch e dispara `onAction` no sucesso
 * pra o board recarregar e limpar seleção.
 */

import { useState } from 'react'
import { X, ChevronDown, Tag, MailX, Trash2, ArrowRight, Loader2 } from 'lucide-react'
import { STAGES } from '@/lib/marketing/stages'
import { toast } from 'sonner'

interface Props {
  selectedIds: Set<string>
  onClear: () => void
  /** Chamado após batch op com sucesso (deve recarregar dados + limpar seleção) */
  onAction: () => void
}

export function BatchToolbar({ selectedIds, onClear, onAction }: Props) {
  const [busy, setBusy] = useState(false)
  const [stageMenuOpen, setStageMenuOpen] = useState(false)
  const [tagInputOpen, setTagInputOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')

  const count = selectedIds.size
  if (count === 0) return null

  async function callBatch(body: any, successMsg: string) {
    setBusy(true)
    try {
      const r = await fetch('/api/marketing/contatos/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ids: [...selectedIds] }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j?.error || `Erro ${r.status}`)
        return
      }
      const affected = j?.data?.affected ?? 0
      toast.success(`${successMsg} — ${affected} contato${affected === 1 ? '' : 's'} afetado${affected === 1 ? '' : 's'}`)
      onAction()
    } finally {
      setBusy(false)
      setStageMenuOpen(false)
      setTagInputOpen(false)
      setTagInput('')
    }
  }

  async function applyStage(stage: string) {
    await callBatch({ action: 'set_stage', payload: { stage } }, `Movidos pra ${STAGES.find(s => s.key === stage)?.label}`)
  }

  async function applyTag() {
    const t = tagInput.trim()
    if (!t) return
    await callBatch({ action: 'add_tags', payload: { tags: [t] } }, `Tag "${t}" adicionada`)
  }

  async function applyUnsubscribe() {
    if (!confirm(`Marcar ${count} contato${count === 1 ? '' : 's'} como descadastrado${count === 1 ? '' : 's'}?\nEles não receberão mais campanhas.`)) return
    await callBatch({ action: 'unsubscribe' }, `Descadastrados`)
  }

  async function applyDelete() {
    if (!confirm(`APAGAR ${count} contato${count === 1 ? '' : 's'} permanentemente?\nEssa ação não pode ser desfeita.`)) return
    await callBatch({ action: 'delete' }, `Apagados`)
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 transform">
      <div className="flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-2xl ring-1 ring-white/10 dark:bg-gray-800">
        {/* Contador */}
        <div className="flex items-center gap-2 pr-2">
          <span className="inline-flex items-center justify-center rounded-full bg-blue-500 px-2 py-0.5 text-xs font-semibold">
            {count}
          </span>
          <span className="text-xs text-gray-300">selecionado{count === 1 ? '' : 's'}</span>
        </div>

        <div className="h-5 w-px bg-white/20" />

        {/* Mover para fase X (dropdown) */}
        <div className="relative">
          <button
            onClick={() => { setStageMenuOpen(o => !o); setTagInputOpen(false) }}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Mover para
            <ChevronDown className="h-3 w-3" />
          </button>
          {stageMenuOpen && (
            <div className="absolute bottom-full mb-2 left-0 min-w-[200px] rounded-lg bg-gray-800 p-1 shadow-xl ring-1 ring-white/10">
              {STAGES.map(s => (
                <button
                  key={s.key}
                  onClick={() => applyStage(s.key)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs hover:bg-white/10"
                >
                  <span>{s.emoji}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Adicionar tag (input inline) */}
        <div className="relative">
          <button
            onClick={() => { setTagInputOpen(o => !o); setStageMenuOpen(false) }}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
          >
            <Tag className="h-3.5 w-3.5" />
            Tag
          </button>
          {tagInputOpen && (
            <div className="absolute bottom-full mb-2 left-0 flex gap-1 rounded-lg bg-gray-800 p-2 shadow-xl ring-1 ring-white/10">
              <input
                autoFocus
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applyTag()}
                placeholder="ex: lead_qualificado"
                maxLength={60}
                className="w-44 rounded bg-gray-900 px-2 py-1 text-xs outline-none ring-1 ring-white/10 focus:ring-blue-500"
              />
              <button
                onClick={applyTag}
                disabled={!tagInput.trim() || busy}
                className="rounded bg-blue-600 px-2 py-1 text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Aplicar
              </button>
            </div>
          )}
        </div>

        {/* Descadastrar */}
        <button
          onClick={applyUnsubscribe}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-orange-300 hover:bg-orange-500/10 disabled:opacity-50"
          title="Descadastrar selecionados (não recebem campanhas)"
        >
          <MailX className="h-3.5 w-3.5" />
          Descadastrar
        </button>

        {/* Apagar */}
        <button
          onClick={applyDelete}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
          title="Apagar permanentemente"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Apagar
        </button>

        <div className="h-5 w-px bg-white/20" />

        {/* Loading indicator */}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}

        {/* Fechar */}
        <button
          onClick={onClear}
          disabled={busy}
          className="rounded-full p-1 hover:bg-white/10 disabled:opacity-50"
          title="Limpar seleção (Esc)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
