'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Plus, ArrowLeft, Store, User, History, Loader2 } from 'lucide-react'

interface Terminal {
  id: string
  acquirer: string
  terminal_code: string
  assignment_type: 'DRIVER' | 'STORE'
  user_id: string | null
  user_name: string | null
  valid_from: string
  valid_to: string | null
  notes: string | null
}

interface UserProfile { id: string; name: string; role_id: string }

export default function ConfigurarMaquininhasPage() {
  const [showHistory, setShowHistory] = useState(false)
  const [items, setItems] = useState<Terminal[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState<{ terminal_code?: string } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/financeiro/maquininha/terminals${showHistory ? '?include_history=1' : ''}`),
        fetch('/api/users?simple=true'),
      ])
      const j1 = await r1.json()
      const j2 = await r2.json()
      setItems(j1.data || [])
      // Filtra so motoristas
      const allUsers: UserProfile[] = j2.data || j2 || []
      setUsers(allUsers.filter(u => /motorista|driver/i.test(u.role_id || '')))
    } catch {
      toast.error('Erro ao carregar')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [showHistory])

  return (
    <div className="container mx-auto px-6 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/financeiro/maquininha" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Configurar Maquininhas</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Atribua cada terminal a um motorista ou marque como Loja</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowHistory(!showHistory)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 text-xs font-semibold cursor-pointer ${showHistory ? 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:border-amber-800' : 'border-gray-300 dark:border-zinc-700 text-gray-700'}`}>
            <History className="h-3.5 w-3.5" /> {showHistory ? 'Ocultar historico' : 'Ver historico'}
          </button>
          <button type="button" onClick={() => setCreating({})}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer">
            <Plus className="h-4 w-4" /> Adicionar maquininha
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16"><Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-zinc-900 rounded-xl border-2 border-dashed border-gray-300 dark:border-zinc-700">
          <p className="text-gray-500 mb-4">Nenhuma maquininha configurada ainda.</p>
          <p className="text-sm text-gray-400 mb-4">Quando importar o 1º CSV da Rede, os codigos das maquininhas vao aparecer nas transacoes — entao volte aqui pra atribuir cada uma a um motorista ou a Loja.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-zinc-800/50 border-b border-gray-200 dark:border-zinc-700">
              <tr className="text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
                <th className="px-4 py-3">Codigo</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Atribuida a</th>
                <th className="px-4 py-3">Vigencia</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Acao</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {items.map(t => (
                <tr key={t.id} className={`${t.valid_to ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-gray-100">{t.terminal_code}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                      t.assignment_type === 'STORE'
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                        : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300'
                    }`}>
                      {t.assignment_type === 'STORE' ? <><Store className="h-3.5 w-3.5" /> Loja</> : <><User className="h-3.5 w-3.5" /> Motorista</>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                    {t.user_name || (t.assignment_type === 'STORE' ? 'Balcao' : '—')}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                    Desde {new Date(t.valid_from).toLocaleDateString('pt-BR')}
                    {t.valid_to && ` ate ${new Date(t.valid_to).toLocaleDateString('pt-BR')}`}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {t.valid_to
                      ? <span className="text-gray-500">Encerrada</span>
                      : <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Vigente</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!t.valid_to && (
                      <button type="button" onClick={() => setCreating({ terminal_code: t.terminal_code })}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800 text-xs font-semibold cursor-pointer">
                        Trocar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateModal
          users={users}
          presetCode={creating.terminal_code}
          onClose={() => setCreating(null)}
          onSaved={() => { setCreating(null); load() }}
        />
      )}
    </div>
  )
}

function CreateModal({ users, presetCode, onClose, onSaved }: {
  users: UserProfile[]
  presetCode?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [terminalCode, setTerminalCode] = useState(presetCode || '')
  const [type, setType] = useState<'DRIVER' | 'STORE'>('DRIVER')
  const [userId, setUserId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!terminalCode.trim()) { toast.error('Codigo da maquininha obrigatorio'); return }
    if (type === 'DRIVER' && !userId) { toast.error('Escolha um motorista'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/financeiro/maquininha/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminal_code: terminalCode.trim(),
          assignment_type: type,
          user_id: type === 'DRIVER' ? userId : null,
          notes: notes || null,
        }),
      })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error || 'Falha ao salvar'); return }
      toast.success(presetCode ? 'Atribuicao trocada' : 'Maquininha adicionada')
      onSaved()
    } catch {
      toast.error('Erro de rede')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 mb-4">
          {presetCode ? `Trocar atribuicao de ${presetCode}` : 'Adicionar maquininha'}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Codigo da maquininha</label>
            <input type="text" value={terminalCode} onChange={e => setTerminalCode(e.target.value)}
              disabled={!!presetCode}
              placeholder="Ex: SD130361"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 disabled:opacity-60 font-mono" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Tipo</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'DRIVER', label: 'Com motorista', icon: User },
                { v: 'STORE', label: 'Na loja (balcao)', icon: Store },
              ].map(opt => (
                <button key={opt.v} type="button" onClick={() => setType(opt.v as any)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-semibold cursor-pointer ${
                    type === opt.v
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                      : 'border-gray-200 dark:border-zinc-700 text-gray-600'
                  }`}>
                  <opt.icon className="h-4 w-4" /> {opt.label}
                </button>
              ))}
            </div>
          </div>

          {type === 'DRIVER' && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Motorista</label>
              <select value={userId} onChange={e => setUserId(e.target.value)}
                aria-label="Selecionar motorista"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800">
                <option value="">Selecione...</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Observacoes (opcional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} placeholder="Ex: maquininha nova adquirida em 28/04"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm" />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-gray-300 text-sm cursor-pointer">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold cursor-pointer">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
