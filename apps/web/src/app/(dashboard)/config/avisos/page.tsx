'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/use-auth'
import { Bell, Save, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface AvisoSettings {
  'avisos.force_read_enabled': boolean
  'avisos.force_read_min_priority': string
  'avisos.polling_interval_seconds': number
  'avisos.auto_expire_days': number
}

const defaultSettings: AvisoSettings = {
  'avisos.force_read_enabled': true,
  'avisos.force_read_min_priority': 'IMPORTANTE',
  'avisos.polling_interval_seconds': 30,
  'avisos.auto_expire_days': 0,
}

const priorityOptions = [
  { value: 'INFO', label: 'Info (todos os avisos)' },
  { value: 'NORMAL', label: 'Normal e acima' },
  { value: 'IMPORTANTE', label: 'Importante e acima' },
  { value: 'URGENTE', label: 'Somente Urgente' },
]

export default function ConfigAvisosPage() {
  const { isAdmin } = useAuth()
  const [settings, setSettings] = useState<AvisoSettings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        const all = data.data || {}
        const avisos = all.avisos || {}
        const merged = { ...defaultSettings }
        for (const [fullKey, setting] of Object.entries(avisos) as [string, any][]) {
          const val = setting.value
          if (fullKey in merged) {
            if (typeof (merged as any)[fullKey] === 'boolean') {
              (merged as any)[fullKey] = val === 'true' || val === true
            } else if (typeof (merged as any)[fullKey] === 'number') {
              (merged as any)[fullKey] = Number(val) || 0
            } else {
              (merged as any)[fullKey] = val
            }
          }
        }
        setSettings(merged)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    const payload = Object.entries(settings).map(([key, value]) => ({
      key,
      value: String(value),
      type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string',
    }))

    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: payload }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-sm text-gray-400">
        Apenas administradores podem acessar esta pagina.
      </div>
    )
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-gray-400">Carregando...</div>
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Bell className="h-6 w-6" />
            Configuracoes de Avisos
          </h1>
          <p className="text-sm text-gray-500">Controle como os avisos sao exibidos e quais exigem confirmacao de leitura</p>
        </div>
      </div>

      <div className="rounded-lg border bg-white dark:bg-gray-800 p-6 shadow-sm space-y-6">
        {/* Leitura obrigatoria */}
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Leitura Obrigatoria</h2>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings['avisos.force_read_enabled']}
              onChange={e => setSettings(s => ({ ...s, 'avisos.force_read_enabled': e.target.checked }))}
              className="rounded border-gray-300 h-4 w-4"
            />
            <div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Ativar modal de leitura obrigatoria
              </span>
              <p className="text-xs text-gray-400">
                Quando ativado, avisos marcados como "leitura obrigatoria" bloqueiam a tela ate o usuario confirmar
              </p>
            </div>
          </label>
        </div>

        {/* Prioridade minima */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Prioridade minima para forcar leitura
          </label>
          <select
            value={settings['avisos.force_read_min_priority']}
            onChange={e => setSettings(s => ({ ...s, 'avisos.force_read_min_priority': e.target.value }))}
            className="rounded-lg border px-3 py-2 text-sm w-full max-w-xs focus:border-blue-500 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            {priorityOptions.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            Avisos com prioridade abaixo desta nao exigirao confirmacao mesmo se marcados
          </p>
        </div>

        {/* Polling interval */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Intervalo de verificacao (segundos)
          </label>
          <input
            type="number"
            min={10}
            max={300}
            value={settings['avisos.polling_interval_seconds']}
            onChange={e => setSettings(s => ({ ...s, 'avisos.polling_interval_seconds': Math.max(10, Number(e.target.value)) }))}
            className="rounded-lg border px-3 py-2 text-sm w-32 focus:border-blue-500 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          />
          <p className="mt-1 text-xs text-gray-400">
            Com que frequencia o sistema verifica novos avisos (minimo 10s)
          </p>
        </div>

        {/* Auto expire */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Expirar avisos automaticamente apos (dias)
          </label>
          <input
            type="number"
            min={0}
            max={365}
            value={settings['avisos.auto_expire_days']}
            onChange={e => setSettings(s => ({ ...s, 'avisos.auto_expire_days': Math.max(0, Number(e.target.value)) }))}
            className="rounded-lg border px-3 py-2 text-sm w-32 focus:border-blue-500 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          />
          <p className="mt-1 text-xs text-gray-400">
            0 = nunca expirar automaticamente. Avisos sem data de expiracao ficam vissiveis para sempre.
          </p>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Salvando...' : 'Salvar Configuracoes'}
        </button>
        {saved && (
          <span className="text-sm text-green-600 font-medium">Salvo com sucesso!</span>
        )}
      </div>
    </div>
  )
}
