'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, RotateCcw, Save, Eye, Code } from 'lucide-react'

export default function EmailTemplatesPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [html, setHtml] = useState('')
  const [subject, setSubject] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [defaultHtml, setDefaultHtml] = useState('')
  const [defaultSubject, setDefaultSubject] = useState('')
  const [tab, setTab] = useState<'preview' | 'code'>('preview')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/email-templates/feedback', { cache: 'no-store' })
      if (!res.ok) { toast.error('Falha ao carregar'); return }
      const j = await res.json()
      setHtml(j.data.html || '')
      setSubject(j.data.subject || '')
      setIsCustom(!!j.data.is_custom)
      setDefaultHtml(j.data.default.html || '')
      setDefaultSubject(j.data.default.subject || '')
    } catch { toast.error('Falha de rede') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/email-templates/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, subject }),
      })
      if (!res.ok) { toast.error('Falha ao salvar'); return }
      toast.success('Template salvo')
      setIsCustom(true)
    } catch { toast.error('Falha de rede') }
    finally { setSaving(false) }
  }

  async function reset() {
    if (!window.confirm('Restaurar template padrao? Suas edicoes serao perdidas.')) return
    setSaving(true)
    try {
      const res = await fetch('/api/settings/email-templates/feedback', { method: 'DELETE' })
      if (!res.ok) { toast.error('Falha ao restaurar'); return }
      toast.success('Template restaurado')
      setHtml(defaultHtml)
      setSubject(defaultSubject)
      setIsCustom(false)
    } finally { setSaving(false) }
  }

  // Preview com variaveis de exemplo
  const previewHtml = html
    .replace(/\{\{cliente\}\}/g, 'Maria Silva')
    .replace(/\{\{primeiro_nome\}\}/g, 'Maria')
    .replace(/\{\{empresa\}\}/g, 'PontualTech')
    .replace(/\{\{os_number\}\}/g, '60123')
    .replace(/\{\{link\}\}/g, 'https://portal.pontualtech.com.br/avaliar/exemplo')

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="text-gray-500 hover:text-gray-900">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Template de E-mail · Avaliação</h1>
            <p className="text-xs text-gray-500">
              Enviado automaticamente 10 min apos entrega aprovada.
              {isCustom ? ' — ' : ' — '}
              <span className={isCustom ? 'text-indigo-600 font-medium' : 'text-gray-400'}>
                {isCustom ? 'Customizado' : 'Padrao'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isCustom && (
            <button onClick={reset} disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <RotateCcw className="w-4 h-4" /> Restaurar padrao
            </button>
          )}
          <button onClick={save} disabled={saving || loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : (
        <>
          <div className="rounded-xl border bg-white p-4 shadow-sm space-y-2">
            <label className="text-xs font-medium text-gray-600">Assunto do e-mail</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <p className="text-[11px] text-gray-400">
              Variaveis: <code className="bg-gray-100 px-1 rounded">{'{{empresa}}'}</code>{' '}
              <code className="bg-gray-100 px-1 rounded">{'{{os_number}}'}</code>{' '}
              <code className="bg-gray-100 px-1 rounded">{'{{cliente}}'}</code>
            </p>
          </div>

          <div className="rounded-xl border bg-white shadow-sm">
            <div className="border-b flex items-center justify-between px-4 py-2">
              <h2 className="text-sm font-semibold text-gray-700">Corpo HTML</h2>
              <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
                <button onClick={() => setTab('preview')}
                  className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1 ${tab === 'preview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}>
                  <Eye className="w-3 h-3" /> Preview
                </button>
                <button onClick={() => setTab('code')}
                  className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1 ${tab === 'code' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}>
                  <Code className="w-3 h-3" /> HTML
                </button>
              </div>
            </div>
            {tab === 'preview' ? (
              <div className="p-0 h-[600px] overflow-auto bg-gray-50">
                <iframe
                  title="Preview"
                  srcDoc={previewHtml}
                  sandbox="allow-same-origin"
                  className="w-full h-full bg-white border-0"
                />
              </div>
            ) : (
              <textarea
                value={html}
                onChange={e => setHtml(e.target.value)}
                className="w-full h-[600px] border-0 p-4 font-mono text-xs focus:outline-none resize-none"
                spellCheck={false}
              />
            )}
            <div className="border-t px-4 py-2 text-[11px] text-gray-500 bg-gray-50">
              Variaveis disponiveis:{' '}
              <code className="bg-white border px-1 rounded mr-1">{'{{cliente}}'}</code>
              <code className="bg-white border px-1 rounded mr-1">{'{{primeiro_nome}}'}</code>
              <code className="bg-white border px-1 rounded mr-1">{'{{empresa}}'}</code>
              <code className="bg-white border px-1 rounded mr-1">{'{{os_number}}'}</code>
              <code className="bg-white border px-1 rounded">{'{{link}}'}</code>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
