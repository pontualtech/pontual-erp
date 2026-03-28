'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/use-auth'
import { cn } from '@/lib/utils'
import { Bell, Pin, PinOff, Pencil, Trash2, Plus, X } from 'lucide-react'

interface Aviso {
  id: string
  title: string
  message: string
  priority: string
  author_name: string | null
  pinned: boolean
  expires_at: string | null
  created_at: string
}

const priorityOptions = [
  { value: 'INFO', label: 'Info', color: 'bg-gray-100 text-gray-700' },
  { value: 'NORMAL', label: 'Normal', color: 'bg-blue-100 text-blue-700' },
  { value: 'IMPORTANTE', label: 'Importante', color: 'bg-amber-100 text-amber-700' },
  { value: 'URGENTE', label: 'Urgente', color: 'bg-red-100 text-red-700' },
]

function getPriorityStyle(p: string) {
  return priorityOptions.find(o => o.value === p)?.color || 'bg-gray-100 text-gray-700'
}

function getPriorityLabel(p: string) {
  return priorityOptions.find(o => o.value === p)?.label || p
}

export default function AvisosPage() {
  const { user, isAdmin } = useAuth()
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ title: '', message: '', priority: 'NORMAL', pinned: false, expires_at: '' })

  const loadAvisos = async () => {
    try {
      const res = await fetch('/api/avisos?showExpired=true')
      const json = await res.json()
      if (json.data) setAvisos(json.data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadAvisos() }, [])

  const resetForm = () => {
    setForm({ title: '', message: '', priority: 'NORMAL', pinned: false, expires_at: '' })
    setEditingId(null)
    setShowForm(false)
  }

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.message.trim()) return

    const payload = {
      title: form.title,
      message: form.message,
      priority: form.priority,
      pinned: form.pinned,
      expires_at: form.expires_at || null,
    }

    if (editingId) {
      await fetch(`/api/avisos/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      await fetch('/api/avisos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    resetForm()
    loadAvisos()
  }

  const togglePin = async (aviso: Aviso) => {
    await fetch(`/api/avisos/${aviso.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !aviso.pinned }),
    })
    loadAvisos()
  }

  const deleteAviso = async (id: string) => {
    if (!confirm('Remover este aviso?')) return
    await fetch(`/api/avisos/${id}`, { method: 'DELETE' })
    loadAvisos()
  }

  const startEdit = (aviso: Aviso) => {
    setForm({
      title: aviso.title,
      message: aviso.message,
      priority: aviso.priority || 'NORMAL',
      pinned: aviso.pinned || false,
      expires_at: aviso.expires_at ? aviso.expires_at.slice(0, 16) : '',
    })
    setEditingId(aviso.id)
    setShowForm(true)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  const isExpired = (aviso: Aviso) => {
    return aviso.expires_at && new Date(aviso.expires_at) < new Date()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Bell className="h-6 w-6" />
          Avisos e Comunicados
        </h1>
        {isAdmin && (
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Novo Aviso
          </button>
        )}
      </div>

      {/* Create/Edit form */}
      {showForm && isAdmin && (
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">
              {editingId ? 'Editar Aviso' : 'Novo Aviso'}
            </h2>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Titulo do aviso"
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <textarea
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              placeholder="Mensagem"
              rows={3}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none"
            />
            <div className="flex flex-wrap gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Prioridade</label>
                <select
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  className="rounded-lg border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {priorityOptions.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Expira em</label>
                <input
                  type="datetime-local"
                  value={form.expires_at}
                  onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                  className="rounded-lg border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.pinned}
                    onChange={e => setForm(f => ({ ...f, pinned: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Fixar</span>
                </label>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSubmit}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                {editingId ? 'Salvar' : 'Publicar'}
              </button>
              <button
                onClick={resetForm}
                className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Announcements list */}
      {loading ? (
        <p className="text-sm text-gray-400">Carregando...</p>
      ) : avisos.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
          <Bell className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-2 text-sm text-gray-400">Nenhum aviso publicado</p>
        </div>
      ) : (
        <div className="space-y-3">
          {avisos.map(aviso => (
            <div
              key={aviso.id}
              className={cn(
                'rounded-lg border bg-white p-4 shadow-sm',
                isExpired(aviso) && 'opacity-50',
                aviso.pinned && 'border-l-4 border-l-amber-400'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {aviso.pinned && <Pin className="h-3.5 w-3.5 text-amber-500" />}
                    <h3 className="font-semibold text-gray-900">{aviso.title}</h3>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', getPriorityStyle(aviso.priority))}>
                      {getPriorityLabel(aviso.priority)}
                    </span>
                    {isExpired(aviso) && (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">Expirado</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{aviso.message}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                    {aviso.author_name && <span>Por {aviso.author_name}</span>}
                    <span>{formatDate(aviso.created_at)}</span>
                    {aviso.expires_at && (
                      <span>Expira: {formatDate(aviso.expires_at)}</span>
                    )}
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => togglePin(aviso)}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      title={aviso.pinned ? 'Desafixar' : 'Fixar'}
                    >
                      {aviso.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => startEdit(aviso)}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => deleteAviso(aviso.id)}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      title="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
