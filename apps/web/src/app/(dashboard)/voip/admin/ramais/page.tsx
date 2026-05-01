'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Hash, User, Loader2, RefreshCw, Plus, Trash2, Edit3, Save, X, Power, Wifi, Phone } from 'lucide-react'

interface Extension {
  id: string
  number: string
  description: string
  caller_id_internal: string | null
  webrtc: boolean
  max_contacts: number
  call_limit: number
  is_active: boolean
  user_id: string | null
  user_name: string | null
  user_email: string | null
}

interface UserOption { id: string; name: string; email: string }

export default function VoipAdminRamaisPage() {
  const [items, setItems] = useState<Extension[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<Extension>>({})
  const [creating, setCreating] = useState(false)
  const [createDraft, setCreateDraft] = useState({ number: '', description: '', user_id: '', webrtc: true })

  function load() {
    setLoading(true)
    setError('')
    Promise.all([
      fetch('/api/voip/admin/extensions', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/users?company_only=true', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([ext, u]) => {
      if (ext.error) {
        setError(typeof ext.error === 'string' ? ext.error : (ext.error?.message || 'Erro'))
        return
      }
      setItems(ext.data || [])
      setUsers(((u.data as any[]) || []).map(x => ({ id: x.id, name: x.name, email: x.email })))
    }).catch(() => setError('Erro ao carregar')).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function startEdit(e: Extension) {
    setEditing(e.id)
    setDraft({
      description: e.description,
      caller_id_internal: e.caller_id_internal,
      user_id: e.user_id,
      webrtc: e.webrtc,
      max_contacts: e.max_contacts,
      call_limit: e.call_limit,
      is_active: e.is_active,
    })
  }

  async function saveEdit() {
    if (!editing) return
    const r = await fetch(`/api/voip/admin/extensions/${editing}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    if (r.ok) { setEditing(null); load() }
    else { const j = await r.json().catch(() => ({})); alert('Falha: ' + (j.error?.message || j.error || r.status)) }
  }

  async function toggleActive(e: Extension) {
    await fetch(`/api/voip/admin/extensions/${e.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !e.is_active }),
    })
    load()
  }

  async function remove(e: Extension) {
    if (!confirm(`Remover ramal ${e.number} (${e.description})?`)) return
    const r = await fetch(`/api/voip/admin/extensions/${e.id}`, { method: 'DELETE' })
    if (r.ok) load()
    else alert('Falha ao remover')
  }

  async function createNew() {
    if (!createDraft.number || !createDraft.description) {
      alert('Preencha número e descrição'); return
    }
    const r = await fetch('/api/voip/admin/extensions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: createDraft.number,
        description: createDraft.description,
        user_id: createDraft.user_id || null,
        webrtc: createDraft.webrtc,
      }),
    })
    if (r.ok) {
      setCreating(false)
      setCreateDraft({ number: '', description: '', user_id: '', webrtc: true })
      load()
    } else {
      const j = await r.json().catch(() => ({}))
      alert('Falha: ' + (j.error?.message || j.error || r.status))
    }
  }

  async function regenerateConfig() {
    const r = await fetch('/api/voip/admin/regenerate-config', { method: 'POST' }).catch(() => null)
    if (r?.ok) alert('Config regenerada e Asterisk recarregado.')
    else alert('Falha — implemente F2.4 ou rode manual no servidor.')
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Hash className="h-6 w-6 text-blue-600" /> Ramais SIP — Administração
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Cadastre, edite e atribua ramais a usuários. Mudanças exigem clicar em <strong>Aplicar no Asterisk</strong> pra entrarem em vigor.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </button>
          <button type="button" onClick={regenerateConfig} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-md">
            <Power className="h-4 w-4" /> Aplicar no Asterisk
          </button>
          <button type="button" onClick={() => setCreating(!creating)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md">
            <Plus className="h-4 w-4" /> Novo ramal
          </button>
        </div>
      </div>

      {creating && (
        <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4 space-y-3">
          <h2 className="font-semibold text-blue-900">Novo ramal</h2>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Número (3 dígitos)</label>
              <input type="text" value={createDraft.number} onChange={e => setCreateDraft({...createDraft, number: e.target.value.replace(/\D/g,'').slice(0,5)})} className="w-full px-2 py-1.5 text-sm border rounded-md" placeholder="116" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Descrição</label>
              <input type="text" value={createDraft.description} onChange={e => setCreateDraft({...createDraft, description: e.target.value})} className="w-full px-2 py-1.5 text-sm border rounded-md" placeholder="João - Ramal 116" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Usuário (opcional)</label>
              <select value={createDraft.user_id} onChange={e => setCreateDraft({...createDraft, user_id: e.target.value})} className="w-full px-2 py-1.5 text-sm border rounded-md">
                <option value="">— sem usuário —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
            <button type="button" onClick={createNew} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md">Criar</button>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-white shadow-sm">
        {loading && <div className="py-12 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin inline-block" /></div>}
        {error && <div className="p-6 text-center text-red-600">{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="py-12 text-center text-gray-400 text-sm">
            Nenhum ramal cadastrado. Use <strong>Novo ramal</strong> ou rode a migração inicial.
          </div>
        )}
        {!loading && !error && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <th className="px-4 py-3">Número</th>
                  <th className="px-4 py-3">Descrição</th>
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map(e => editing === e.id ? (
                  <tr key={e.id} className="bg-amber-50">
                    <td className="px-4 py-3 font-mono font-bold">{e.number}</td>
                    <td className="px-4 py-3">
                      <input type="text" value={String(draft.description ?? '')} onChange={ev => setDraft({...draft, description: ev.target.value})}
                        className="w-full px-2 py-1 text-sm border rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <select value={draft.user_id ?? ''} onChange={ev => setDraft({...draft, user_id: ev.target.value || null})}
                        className="w-full px-2 py-1 text-sm border rounded">
                        <option value="">— sem usuário —</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={!!draft.webrtc} onChange={ev => setDraft({...draft, webrtc: ev.target.checked})} />
                        WebRTC (browser)
                      </label>
                    </td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={!!draft.is_active} onChange={ev => setDraft({...draft, is_active: ev.target.checked})} />
                        Ativo
                      </label>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={saveEdit} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">
                        <Save className="h-3 w-3" /> Salvar
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="ml-2 inline-flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-50">
                        <X className="h-3 w-3" /> Cancelar
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-blue-700 bg-blue-100 px-2 py-1 rounded">{e.number}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{e.description}</div>
                      {e.caller_id_internal && <div className="text-xs text-gray-500">{e.caller_id_internal}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {e.user_name ? (
                        <div>
                          <div className="text-gray-900 flex items-center gap-1"><User className="h-3 w-3" /> {e.user_name}</div>
                          <div className="text-xs text-gray-500">{e.user_email}</div>
                        </div>
                      ) : <span className="text-gray-300 text-xs italic">— sem usuário —</span>}
                    </td>
                    <td className="px-4 py-3">
                      {e.webrtc ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                          <Wifi className="h-3 w-3" /> Browser
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                          <Phone className="h-3 w-3" /> SIP físico
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => toggleActive(e)} className={`text-xs px-2 py-0.5 rounded-full font-medium ${e.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {e.is_active ? 'Ativo' : 'Inativo'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => startEdit(e)} className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs mr-3">
                        <Edit3 className="h-3 w-3" /> Editar
                      </button>
                      <button type="button" onClick={() => remove(e)} className="inline-flex items-center gap-1 text-red-600 hover:underline text-xs">
                        <Trash2 className="h-3 w-3" /> Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-blue-50 p-3 text-xs text-blue-900">
        <strong>📌 Workflow</strong>: criar/editar ramal aqui só atualiza o banco. Pra fazer o Asterisk aceitar
        registro do novo ramal, clique em <strong>Aplicar no Asterisk</strong> (regenera <code>pjsip.conf</code> e
        recarrega <code>res_pjsip</code>).
      </div>
    </div>
  )
}
