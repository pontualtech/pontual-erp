'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2 } from 'lucide-react'

export default function MarcasModelosPage() {
  const [marcas, setMarcas] = useState<string[]>([])
  const [modelos, setModelos] = useState<string[]>([])
  const [selectedMarca, setSelectedMarca] = useState<string | null>(null)
  const [loadingMarcas, setLoadingMarcas] = useState(true)
  const [loadingModelos, setLoadingModelos] = useState(false)
  const [novaMarca, setNovaMarca] = useState('')
  const [novoModelo, setNovoModelo] = useState('')
  const [savingMarca, setSavingMarca] = useState(false)
  const [savingModelo, setSavingModelo] = useState(false)
  const [deletingMarca, setDeletingMarca] = useState<string | null>(null)
  const [deletingModelo, setDeletingModelo] = useState<string | null>(null)

  function loadMarcas() {
    setLoadingMarcas(true)
    fetch('/api/equipamentos?type=marcas')
      .then(r => r.json())
      .then(d => setMarcas(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar marcas'))
      .finally(() => setLoadingMarcas(false))
  }

  function loadModelos(marca: string) {
    setLoadingModelos(true)
    fetch(`/api/equipamentos?type=modelos&marca=${encodeURIComponent(marca)}`)
      .then(r => r.json())
      .then(d => setModelos(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar modelos'))
      .finally(() => setLoadingModelos(false))
  }

  useEffect(() => { loadMarcas() }, [])

  useEffect(() => {
    if (selectedMarca) loadModelos(selectedMarca)
    else setModelos([])
  }, [selectedMarca])

  async function addMarca() {
    if (!novaMarca.trim()) return
    setSavingMarca(true)
    try {
      const res = await fetch('/api/equipamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'marca', value: novaMarca.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')
      setNovaMarca('')
      loadMarcas()
      toast.success('Marca adicionada!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally { setSavingMarca(false) }
  }

  async function deleteMarca(marca: string) {
    if (!confirm(`Excluir "${marca}" e todos seus modelos?`)) return
    setDeletingMarca(marca)
    try {
      const res = await fetch('/api/equipamentos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'marca', value: marca }),
      })
      if (!res.ok) throw new Error('Erro ao excluir')
      if (selectedMarca === marca) { setSelectedMarca(null); setModelos([]) }
      loadMarcas()
      toast.success('Marca excluida!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally { setDeletingMarca(null) }
  }

  async function addModelo() {
    if (!novoModelo.trim() || !selectedMarca) return
    setSavingModelo(true)
    try {
      const res = await fetch('/api/equipamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'modelo', marca: selectedMarca, value: novoModelo.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')
      setNovoModelo('')
      loadModelos(selectedMarca)
      toast.success('Modelo adicionado!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally { setSavingModelo(false) }
  }

  async function deleteModelo(modelo: string) {
    if (!selectedMarca) return
    setDeletingModelo(modelo)
    try {
      const res = await fetch('/api/equipamentos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'modelo', marca: selectedMarca, value: modelo }),
      })
      if (!res.ok) throw new Error('Erro ao excluir')
      loadModelos(selectedMarca)
      toast.success('Modelo excluido!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally { setDeletingModelo(null) }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Marcas e Modelos</h1>
      <p className="text-sm text-gray-500">Gerencie as marcas e modelos de equipamentos disponiveis no formulario de OS.</p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Brands */}
        <div className="rounded-lg border bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold text-gray-900">Marcas</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={novaMarca}
                onChange={e => setNovaMarca(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMarca() } }}
                placeholder="Nova marca..."
                className="flex-1 px-3 py-2 border rounded-md text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 focus:outline-none"
              />
              <button
                type="button"
                onClick={addMarca}
                disabled={savingMarca || !novaMarca.trim()}
                className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {savingMarca ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
            </div>

            {loadingMarcas ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : marcas.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400">Nenhuma marca cadastrada</p>
            ) : (
              <ul className="divide-y max-h-[60vh] overflow-y-auto">
                {marcas.map(m => (
                  <li
                    key={m}
                    className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer rounded transition-colors ${
                      selectedMarca === m ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-gray-50 text-gray-700'
                    }`}
                    onClick={() => setSelectedMarca(m)}
                  >
                    <span>{m}</span>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); deleteMarca(m) }}
                      disabled={deletingMarca === m}
                      className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingMarca === m ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: Models */}
        <div className="rounded-lg border bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold text-gray-900">
              {selectedMarca ? `Modelos - ${selectedMarca}` : 'Modelos'}
            </h2>
          </div>
          <div className="p-4 space-y-3">
            {selectedMarca ? (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={novoModelo}
                    onChange={e => setNovoModelo(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addModelo() } }}
                    placeholder={`Novo modelo ${selectedMarca}...`}
                    className="flex-1 px-3 py-2 border rounded-md text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={addModelo}
                    disabled={savingModelo || !novoModelo.trim()}
                    className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingModelo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </button>
                </div>

                {loadingModelos ? (
                  <div className="flex items-center justify-center py-8 text-gray-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : modelos.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-400">Nenhum modelo cadastrado para {selectedMarca}</p>
                ) : (
                  <ul className="divide-y max-h-[60vh] overflow-y-auto">
                    {modelos.map(m => (
                      <li key={m} className="flex items-center justify-between px-3 py-2 text-sm text-gray-700">
                        <span>{m}</span>
                        <button
                          type="button"
                          onClick={() => deleteModelo(m)}
                          disabled={deletingModelo === m}
                          className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingModelo === m ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="py-8 text-center text-sm text-gray-400">
                Selecione uma marca para ver os modelos
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
