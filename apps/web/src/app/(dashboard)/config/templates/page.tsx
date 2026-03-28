'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Plus, Star, Trash2, Eye, Loader2, X, FileText, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Template {
  id: string
  type: string
  name: string
  html_template: string
  css_override: string | null
  is_default: boolean
  is_active: boolean
  created_at: string
}

const TABS = [
  { key: 'os', label: 'OS' },
  { key: 'orcamento', label: 'Orcamento' },
  { key: 'recibo', label: 'Recibo' },
  { key: 'email', label: 'Email' },
] as const
type TabKey = typeof TABS[number]['key']

const TEMPLATE_VARS = [
  { group: 'OS', vars: ['os_number', 'status', 'created_at'] },
  { group: 'Cliente', vars: ['customer_name', 'customer_document', 'customer_phone', 'customer_email', 'customer_address'] },
  { group: 'Equipamento', vars: ['equipment_type', 'equipment_brand', 'equipment_model', 'serial_number'] },
  { group: 'Servico', vars: ['reported_issue', 'diagnosis'] },
  { group: 'Valores', vars: ['items_table', 'total_parts', 'total_services', 'total_cost'] },
  { group: 'Empresa', vars: ['company_name', 'company_phone', 'company_email', 'company_address', 'company_cnpj'] },
]

const SAMPLE_DATA: Record<string, string> = {
  os_number: '0042',
  status: 'Em Andamento',
  created_at: '28/03/2026',
  customer_name: 'Joao da Silva',
  customer_document: '123.456.789-00',
  customer_phone: '(11) 98765-4321',
  customer_email: 'joao@email.com',
  customer_address: 'Rua das Flores, 123, Centro, Sao Paulo - SP',
  equipment_type: 'Impressora',
  equipment_brand: 'HP',
  equipment_model: 'LaserJet Pro M404dn',
  serial_number: 'SN12345678',
  reported_issue: 'Impressora nao puxa papel e faz barulho estranho ao ligar.',
  diagnosis: 'Rolete de tracao desgastado. Necessaria substituicao.',
  items_table: '<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:6px 8px;background:#f3f4f6;border-bottom:2px solid #ddd;font-size:10px;text-transform:uppercase;">Tipo</th><th style="text-align:left;padding:6px 8px;background:#f3f4f6;border-bottom:2px solid #ddd;font-size:10px;text-transform:uppercase;">Descricao</th><th style="text-align:right;padding:6px 8px;background:#f3f4f6;border-bottom:2px solid #ddd;font-size:10px;text-transform:uppercase;">Qtd</th><th style="text-align:right;padding:6px 8px;background:#f3f4f6;border-bottom:2px solid #ddd;font-size:10px;text-transform:uppercase;">Valor Unit.</th><th style="text-align:right;padding:6px 8px;background:#f3f4f6;border-bottom:2px solid #ddd;font-size:10px;text-transform:uppercase;">Total</th></tr></thead><tbody><tr><td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;">Peca</td><td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;">Rolete de Tracao HP</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;">1</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;">R$ 85,00</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;">R$ 85,00</td></tr><tr><td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;">Servico</td><td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;">Manutencao Preventiva</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;">1</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;">R$ 120,00</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;">R$ 120,00</td></tr></tbody></table>',
  total_parts: 'R$ 85,00',
  total_services: 'R$ 120,00',
  total_cost: 'R$ 205,00',
  company_name: 'PontualTech',
  company_phone: '(11) 3136-0415',
  company_email: 'contato@pontualtech.work',
  company_address: 'Sao Paulo - SP',
  company_cnpj: '32.772.178/0001-47',
}

export default function TemplatesPage() {
  const [tab, setTab] = useState<TabKey>('os')
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [showEditor, setShowEditor] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Form fields
  const [formName, setFormName] = useState('')
  const [formHtml, setFormHtml] = useState('')
  const [formCss, setFormCss] = useState('')
  const [formDefault, setFormDefault] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  function loadTemplates() {
    setLoading(true)
    fetch(`/api/templates?type=${tab}`)
      .then(r => r.json())
      .then(d => setTemplates(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar templates'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadTemplates() }, [tab])

  function openNew() {
    setEditing(null)
    setFormName('')
    setFormHtml('')
    setFormCss('')
    setFormDefault(templates.length === 0)
    setShowEditor(true)
    setShowPreview(false)
  }

  function openEdit(t: Template) {
    setEditing(t)
    setFormName(t.name)
    setFormHtml(t.html_template)
    setFormCss(t.css_override || '')
    setFormDefault(t.is_default ?? false)
    setShowEditor(true)
    setShowPreview(false)
  }

  async function handleSave() {
    if (!formName.trim()) { toast.error('Nome e obrigatorio'); return }
    if (!formHtml.trim()) { toast.error('HTML do template e obrigatorio'); return }

    setSaving(true)
    try {
      const payload = {
        type: tab,
        name: formName.trim(),
        html_template: formHtml,
        css_override: formCss || null,
        is_default: formDefault,
      }

      const url = editing ? `/api/templates/${editing.id}` : '/api/templates'
      const method = editing ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar')

      toast.success(editing ? 'Template atualizado!' : 'Template criado!')
      setShowEditor(false)
      loadTemplates()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Tem certeza que deseja excluir este template?')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao excluir')
      toast.success('Template excluido!')
      loadTemplates()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setDeleting(null)
    }
  }

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')
      toast.success('Template definido como padrao!')
      loadTemplates()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    }
  }

  function insertVariable(varName: string) {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = `{{${varName}}}`
    const newValue = formHtml.substring(0, start) + text + formHtml.substring(end)
    setFormHtml(newValue)
    // Restore cursor position after the inserted text
    setTimeout(() => {
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = start + text.length
    }, 0)
  }

  function renderPreview() {
    let html = formHtml
    for (const [key, value] of Object.entries(SAMPLE_DATA)) {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
    if (formCss) {
      html = html.replace('</head>', `<style>${formCss}</style></head>`)
    }
    // Remove auto-print script from preview
    html = html.replace(/<script>.*?window\.print\(\).*?<\/script>/gi, '')
    return html
  }

  function handlePreview() {
    setShowPreview(true)
    setTimeout(() => {
      const iframe = iframeRef.current
      if (iframe) {
        const doc = iframe.contentDocument || iframe.contentWindow?.document
        if (doc) {
          doc.open()
          doc.write(renderPreview())
          doc.close()
        }
      }
    }, 100)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-md p-1.5 hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Templates de Impressao</h1>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => { setTab(t.key); setShowEditor(false) }}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Template list or Editor */}
      {!showEditor ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" onClick={openNew}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" /> Novo Template
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500">Nenhum template de {TABS.find(t => t.key === tab)?.label} cadastrado</p>
              <p className="text-sm text-gray-400 mt-1">Clique em "Novo Template" para criar</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map(t => (
                <div key={t.id}
                  className={cn(
                    'rounded-lg border bg-white p-4 shadow-sm transition-colors',
                    t.is_default && 'border-blue-300 bg-blue-50/30'
                  )}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-medium text-gray-900 flex items-center gap-2">
                        {t.name}
                        {t.is_default && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            <Star className="h-3 w-3" /> Padrao
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-gray-400 mt-1">
                        Criado em {new Date(t.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button type="button" onClick={() => openEdit(t)}
                      className="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                      Editar
                    </button>
                    {!t.is_default && (
                      <>
                        <button type="button" onClick={() => handleSetDefault(t.id)}
                          title="Definir como padrao"
                          className="rounded-md border px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50">
                          <Star className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => handleDelete(t.id)}
                          disabled={deleting === t.id} title="Excluir"
                          className="rounded-md border px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                          {deleting === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Editor */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {editing ? `Editar: ${editing.name}` : 'Novo Template'}
            </h2>
            <button type="button" onClick={() => setShowEditor(false)}
              className="rounded-md border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Left column: form */}
            <div className="lg:col-span-2 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
                  <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                    placeholder="Ex: Template Padrao OS"
                    className="w-full px-3 py-2 border rounded-md text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={formDefault} onChange={e => setFormDefault(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-medium text-gray-700">Template padrao</span>
                  </label>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">HTML do Template *</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={handlePreview}
                      className="flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
                      <Eye className="h-3.5 w-3.5" /> Preview
                    </button>
                  </div>
                </div>
                <textarea ref={textareaRef} value={formHtml} onChange={e => setFormHtml(e.target.value)}
                  rows={20}
                  placeholder="Cole ou escreva o HTML do template aqui..."
                  className="w-full px-3 py-2 border rounded-md text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-200 resize-y"
                  style={{ tabSize: 2 }} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CSS Override (opcional)</label>
                <textarea value={formCss} onChange={e => setFormCss(e.target.value)}
                  rows={4}
                  placeholder="CSS adicional para sobrescrever estilos..."
                  className="w-full px-3 py-2 border rounded-md text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-200 resize-y"
                  style={{ tabSize: 2 }} />
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={handleSave} disabled={saving}
                  className="flex items-center gap-2 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? 'Salvando...' : editing ? 'Salvar Alteracoes' : 'Criar Template'}
                </button>
                <button type="button" onClick={() => setShowEditor(false)}
                  className="rounded-md border px-6 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>

            {/* Right column: variables helper */}
            <div className="space-y-4">
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Variaveis Disponiveis</h3>
                <p className="text-xs text-gray-400 mb-3">Clique para inserir no cursor</p>
                <div className="space-y-3">
                  {TEMPLATE_VARS.map(group => (
                    <div key={group.group}>
                      <p className="text-xs font-semibold uppercase text-gray-400 mb-1">{group.group}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.vars.map(v => (
                          <button key={v} type="button" onClick={() => insertVariable(v)}
                            className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs font-mono text-gray-600 hover:bg-blue-100 hover:text-blue-700 transition-colors"
                            title={`Inserir {{${v}}}`}>
                            <Copy className="h-3 w-3 opacity-50" />
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Preview modal */}
          {showPreview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPreview(false)}>
              <div className="w-full max-w-4xl h-[80vh] rounded-lg bg-white shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <h3 className="font-semibold text-gray-900">Preview do Template</h3>
                  <button type="button" onClick={() => setShowPreview(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex-1 p-4 overflow-hidden">
                  <iframe ref={iframeRef}
                    className="w-full h-full border rounded-md"
                    sandbox="allow-same-origin"
                    title="Preview do template" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
