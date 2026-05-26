'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, RotateCcw, Save, Eye, Code } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmailBlocksEditor } from '@/app/(dashboard)/components/email-blocks-editor'
import { renderEmailFromBlocks, embedBlocksInHtml, extractBlocksFromHtml, DEFAULT_QUOTE_REMINDER_BLOCKS, type EmailBlocks } from '@/lib/email-templates/blocks-renderer'

type TemplateKind = 'feedback' | 'recibo' | 'coleta_concluida'

const FEEDBACK_PREVIEW_VARS: Record<string, string> = {
  cliente: 'Maria Silva',
  primeiro_nome: 'Maria',
  empresa: 'PontualTech',
  os_number: '60123',
  link: 'https://portal.pontualtech.com.br/avaliar/exemplo',
}

const RECIBO_PREVIEW_VARS: Record<string, string> = {
  cliente: 'Maria Silva',
  primeiro_nome: 'Maria',
  empresa: 'PontualTech',
  os_number: '60123',
  valor: 'R$ 450,00',
  forma_pagamento: 'Cartao de credito (3x)',
  recebido_por: 'Maria Silva',
  data_hora: '23/04/2026 15:42',
  equipamento_completo: 'Impressora Epson L3250',
  serial_number: 'X3Y-987654',
  garantia_ate: '23/07/2026',
  link_portal: 'https://portal.pontualtech.com.br/portal/pontualtech',
  link_suporte: 'https://wa.me/551126263841',
}

const COLETA_PREVIEW_VARS: Record<string, string> = {
  cliente: 'Maria Silva',
  primeiro_nome: 'Maria',
  empresa: 'PontualTech',
  os_number: '60123',
  equipamento_completo: 'Impressora Epson L3250',
  serial_number: 'X3Y-987654',
  defeito_reportado: 'Nao liga, led amarelo piscando',
  recebido_por: 'Maria Silva',
  data_hora: '23/04/2026 15:42',
  link_portal: 'https://portal.pontualtech.com.br/portal/pontualtech',
  link_suporte: 'https://wa.me/551126263841',
  // Blocos condicionais ficam vazios no preview (a menos que o default use-os)
  checklist_block: '',
  foto_block: '',
  assinatura_block: '',
}

const PREVIEW_VARS: Record<TemplateKind, Record<string, string>> = {
  feedback: FEEDBACK_PREVIEW_VARS,
  recibo: RECIBO_PREVIEW_VARS,
  coleta_concluida: COLETA_PREVIEW_VARS,
}

const VAR_LIST: Record<TemplateKind, string[]> = {
  feedback: ['cliente', 'primeiro_nome', 'empresa', 'os_number', 'link'],
  recibo: [
    'cliente', 'primeiro_nome', 'empresa', 'os_number', 'valor',
    'forma_pagamento', 'recebido_por', 'data_hora', 'equipamento_completo',
    'serial_number', 'garantia_ate', 'link_portal', 'link_suporte',
  ],
  coleta_concluida: [
    'cliente', 'primeiro_nome', 'empresa', 'os_number', 'equipamento_completo',
    'serial_number', 'defeito_reportado', 'recebido_por', 'data_hora',
    'link_portal', 'link_suporte',
  ],
}

export default function EmailTemplatesPage() {
  const [kind, setKind] = useState<TemplateKind>('feedback')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [html, setHtml] = useState('')
  const [subject, setSubject] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [defaultHtml, setDefaultHtml] = useState('')
  const [defaultSubject, setDefaultSubject] = useState('')
  const [tab, setTab] = useState<'visual' | 'preview' | 'code'>('visual')
  // Wave AG-2: estado de blocos extraido do HTML salvo (ou defaults se nao houver)
  const [blocks, setBlocks] = useState<EmailBlocks>(DEFAULT_QUOTE_REMINDER_BLOCKS)

  const load = useCallback(async (k: TemplateKind) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/settings/email-templates/${k.replace(/_/g, '-')}`, { cache: 'no-store' })
      if (!res.ok) { toast.error('Falha ao carregar'); return }
      const j = await res.json()
      const loadedHtml = j.data.html || ''
      setHtml(loadedHtml)
      setSubject(j.data.subject || '')
      setIsCustom(!!j.data.is_custom)
      setDefaultHtml(j.data.default.html || '')
      setDefaultSubject(j.data.default.subject || '')
      // Wave AG-2: extrai blocos embutidos no HTML (se existirem)
      const embedded = extractBlocksFromHtml(loadedHtml)
      setBlocks(embedded || DEFAULT_QUOTE_REMINDER_BLOCKS)
    } catch { toast.error('Falha de rede') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(kind) }, [kind, load])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/settings/email-templates/${kind.replace(/_/g, '-')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, subject }),
      })
      if (!res.ok) { toast.error('Falha ao salvar'); return }
      toast.success('Template salvo')
      setIsCustom(true)
    } finally { setSaving(false) }
  }

  // Wave AG-2: salva do editor visual — gera HTML + embute blocos no comentario
  // pra recarregamento posterior. Usa mesmo endpoint POST (campo html).
  async function saveBlocks() {
    setSaving(true)
    try {
      const generatedHtml = renderEmailFromBlocks(blocks)
      const htmlWithBlocks = embedBlocksInHtml(generatedHtml, blocks)
      const res = await fetch(`/api/settings/email-templates/${kind.replace(/_/g, '-')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlWithBlocks, subject }),
      })
      if (!res.ok) { toast.error('Falha ao salvar editor visual'); return }
      setHtml(htmlWithBlocks)
      setIsCustom(true)
      toast.success('Template visual salvo')
    } finally { setSaving(false) }
  }

  async function reset() {
    if (!window.confirm('Restaurar template padrao? Suas edicoes serao perdidas.')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/settings/email-templates/${kind.replace(/_/g, '-')}`, { method: 'DELETE' })
      if (!res.ok) { toast.error('Falha ao restaurar'); return }
      toast.success('Template restaurado')
      setHtml(defaultHtml)
      setSubject(defaultSubject)
      setIsCustom(false)
    } finally { setSaving(false) }
  }

  const vars = PREVIEW_VARS[kind]
  let previewHtml = html
  for (const [k, v] of Object.entries(vars)) {
    previewHtml = previewHtml.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v)
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="text-gray-500 hover:text-gray-900">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Templates de E-mail</h1>
            <p className="text-xs text-gray-500">
              {isCustom
                ? <span className="text-indigo-600 font-medium">Customizado pela empresa</span>
                : <span className="text-gray-400">Usando template padrao</span>}
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

      {/* Tabs de tipo */}
      <div className="flex gap-2 border-b overflow-x-auto">
        {(['feedback', 'recibo', 'coleta_concluida'] as const).map(k => (
          <button key={k} onClick={() => setKind(k)}
            className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              kind === k ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {k === 'feedback' ? '⭐ Avaliacao (apos entrega)'
              : k === 'recibo' ? '🧾 Recibo de pagamento'
              : '📦 Coleta concluida'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : (
        <>
          <div className="rounded-xl border bg-white p-4 shadow-sm space-y-2">
            <label className="text-xs font-medium text-gray-600" htmlFor="tpl-subject">Assunto do e-mail</label>
            <input id="tpl-subject" value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Assunto do e-mail"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>

          <div className="rounded-xl border bg-white shadow-sm">
            <div className="border-b flex items-center justify-between px-4 py-2">
              <h2 className="text-sm font-semibold text-gray-700">Corpo do e-mail</h2>
              <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
                <button type="button" onClick={() => setTab('visual')}
                  className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1 ${tab === 'visual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}>
                  🎨 Editor visual
                </button>
                <button type="button" onClick={() => setTab('preview')}
                  className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1 ${tab === 'preview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}>
                  <Eye className="w-3 h-3" /> Preview
                </button>
                <button type="button" onClick={() => setTab('code')}
                  className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1 ${tab === 'code' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}>
                  <Code className="w-3 h-3" /> HTML
                </button>
              </div>
            </div>
            {tab === 'visual' ? (
              <div className="p-4">
                {/* Wave AG-3 (audit 2026-05-26): aviso quando template não foi customizado.
                    Editor visual semeia useState com DEFAULT_QUOTE_REMINDER_BLOCKS pra
                    QUALQUER aba (feedback/recibo/coleta_concluida). Clicar Salvar sem
                    editar grava HTML de "Orçamento Pendente" na key da aba — caso 24/05
                    poluiu email_templates.feedback.html, dois NPS saíram com body errado. */}
                {!isCustom && (
                  <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    ⚠️ <strong>Template ainda usa o padrão.</strong> O editor visual carrega blocos de exemplo do template "Orçamento Pendente" como ponto de partida — <strong>edite o conteúdo antes de clicar Salvar</strong>, senão você sobrescreve esta aba com texto irrelevante. Pra usar o template padrão original sem mexer, use a aba "Preview" pra ver e não salve aqui.
                  </div>
                )}
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs text-gray-500">Edita os blocos — preview ao lado atualiza ao vivo.</p>
                  <button type="button" onClick={saveBlocks} disabled={saving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Salvar template visual
                  </button>
                </div>
                <EmailBlocksEditor
                  value={blocks}
                  onChange={setBlocks}
                  availableVars={VAR_LIST[kind].map(v => ({ key: v, desc: v }))}
                  sampleVars={PREVIEW_VARS[kind]}
                />
              </div>
            ) : tab === 'preview' ? (
              <div className="p-0 h-[600px] overflow-auto bg-gray-50">
                <iframe title="Preview" srcDoc={previewHtml} sandbox="allow-same-origin"
                  className="w-full h-full bg-white border-0" />
              </div>
            ) : (
              <textarea
                value={html}
                onChange={e => setHtml(e.target.value)}
                placeholder="HTML do corpo do e-mail"
                aria-label="HTML do corpo do e-mail"
                className="w-full h-[600px] border-0 p-4 font-mono text-xs focus:outline-none resize-none"
                spellCheck={false}
              />
            )}
            <div className="border-t px-4 py-2 text-[11px] text-gray-500 bg-gray-50">
              Variaveis:{' '}
              {VAR_LIST[kind].map(v => (
                <code key={v} className="bg-white border px-1 rounded mr-1">{`{{${v}}}`}</code>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
