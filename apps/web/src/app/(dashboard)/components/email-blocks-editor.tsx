'use client'

/**
 * Wave AG (2026-05-24): editor visual de blocos de email reutilizavel.
 *
 * Usa o tipo EmailBlocks de lib/email-templates/blocks-renderer.ts. UI exibe
 * 1 form por bloco + preview live ao lado. Quando o usuario salva, o caller
 * (pagina de config) chama renderEmailFromBlocks pra gerar HTML completo.
 */

import { useMemo, useState } from 'react'
import { renderEmailFromBlocks, type EmailBlocks } from '@/lib/email-templates/blocks-renderer'

interface Props {
  value: EmailBlocks
  onChange: (next: EmailBlocks) => void
  /** Variaveis disponiveis pra inserir nos textos (ex: {{customer_name}}) */
  availableVars: Array<{ key: string; desc: string }>
  /** Variaveis de exemplo pra renderizar o preview (substitui {{customer_name}} → "Joao") */
  sampleVars?: Record<string, string>
}

const HIGHLIGHT_OPTIONS = [
  { value: 'info' as const, label: '🔵 Azul (info)' },
  { value: 'warning' as const, label: '🟡 Âmbar (atenção)' },
  { value: 'success' as const, label: '🟢 Verde (sucesso)' },
]

const BUTTON_OPTIONS = [
  { value: 'primary' as const, label: '🔵 Azul (primary)' },
  { value: 'success' as const, label: '🟢 Verde (success)' },
]

function applySampleVars(html: string, sample: Record<string, string>): string {
  let out = html
  for (const [k, v] of Object.entries(sample)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v)
  }
  return out
}

export function EmailBlocksEditor({ value, onChange, availableVars, sampleVars = {} }: Props) {
  const [activeSection, setActiveSection] = useState<'header' | 'body' | 'highlight' | 'cta' | 'closing' | 'signature'>('body')

  const previewHtml = useMemo(() => {
    const raw = renderEmailFromBlocks(value)
    return applySampleVars(raw, sampleVars)
  }, [value, sampleVars])

  function upd<K extends keyof EmailBlocks>(key: K, v: EmailBlocks[K]) {
    onChange({ ...value, [key]: v })
  }

  function copyVar(varKey: string) {
    navigator.clipboard.writeText(`{{${varKey}}}`)
  }

  const inputCls = 'w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 outline-none'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  const sections: { id: typeof activeSection; label: string; emoji: string }[] = [
    { id: 'header', label: 'Cabeçalho', emoji: '🎨' },
    { id: 'body', label: 'Corpo', emoji: '📝' },
    { id: 'highlight', label: 'Destaque', emoji: '💡' },
    { id: 'cta', label: 'Botão CTA', emoji: '🔘' },
    { id: 'closing', label: 'Encerramento', emoji: '👋' },
    { id: 'signature', label: 'Assinatura', emoji: '✍️' },
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* ── EDITOR ────────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Variáveis disponíveis */}
        {availableVars.length > 0 && (
          <div className="rounded-lg bg-blue-50 p-3">
            <p className="text-xs font-medium text-blue-800 mb-2">
              Variáveis disponíveis — clique pra copiar e cole onde quiser:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {availableVars.map(v => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => copyVar(v.key)}
                  title={v.desc}
                  className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-mono text-blue-700 hover:bg-blue-200"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
          {sections.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSection(s.id)}
              className={`flex-1 min-w-[80px] rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                activeSection === s.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className="mr-1">{s.emoji}</span>{s.label}
            </button>
          ))}
        </div>

        {/* Form da seção ativa */}
        <div className="rounded-lg border bg-white p-4 space-y-3">
          {activeSection === 'header' && (
            <>
              <div>
                <label className={labelCls}>Emoji (opcional)</label>
                <input className={inputCls} value={value.header.emoji || ''}
                  onChange={e => upd('header', { ...value.header, emoji: e.target.value })}
                  placeholder="📋" />
              </div>
              <div>
                <label className={labelCls}>Título</label>
                <input className={inputCls} value={value.header.title}
                  onChange={e => upd('header', { ...value.header, title: e.target.value })}
                  placeholder="Orçamento Pendente" />
              </div>
              <div>
                <label className={labelCls}>Subtítulo (opcional)</label>
                <input className={inputCls} value={value.header.subtitle || ''}
                  onChange={e => upd('header', { ...value.header, subtitle: e.target.value })}
                  placeholder="{{company_name}}" />
              </div>
            </>
          )}

          {activeSection === 'body' && (
            <>
              <div>
                <label className={labelCls}>Saudação (opcional)</label>
                <input className={inputCls} value={value.greeting || ''}
                  onChange={e => upd('greeting', e.target.value)}
                  placeholder="Oi, {{customer_name}}! 👋" />
              </div>
              <div>
                <label className={labelCls}>Parágrafos do corpo</label>
                {value.paragraphs.map((p, idx) => (
                  <div key={idx} className="mb-2 flex gap-2">
                    <textarea className={inputCls + ' flex-1'} rows={3} value={p}
                      onChange={e => {
                        const next = [...value.paragraphs]
                        next[idx] = e.target.value
                        upd('paragraphs', next)
                      }}
                      placeholder={`Parágrafo ${idx + 1}...`} />
                    <button type="button" title="Remover parágrafo"
                      onClick={() => upd('paragraphs', value.paragraphs.filter((_, i) => i !== idx))}
                      className="px-2 py-1 text-xs border rounded text-red-600 hover:bg-red-50 self-start">✕</button>
                  </div>
                ))}
                <button type="button"
                  onClick={() => upd('paragraphs', [...value.paragraphs, ''])}
                  className="text-xs text-blue-600 hover:text-blue-800">+ Adicionar parágrafo</button>
              </div>
            </>
          )}

          {activeSection === 'highlight' && (
            <>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <input type="checkbox" checked={!!value.highlight_box}
                  onChange={e => upd('highlight_box', e.target.checked ? { style: 'info', text: '' } : undefined)} />
                Mostrar caixa de destaque
              </label>
              {value.highlight_box && (
                <>
                  <div>
                    <label className={labelCls}>Estilo</label>
                    <select className={inputCls} value={value.highlight_box.style}
                      onChange={e => upd('highlight_box', { ...value.highlight_box!, style: e.target.value as any })}>
                      {HIGHLIGHT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Título (opcional)</label>
                    <input className={inputCls} value={value.highlight_box.title || ''}
                      onChange={e => upd('highlight_box', { ...value.highlight_box!, title: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Texto</label>
                    <textarea className={inputCls} rows={2} value={value.highlight_box.text}
                      onChange={e => upd('highlight_box', { ...value.highlight_box!, text: e.target.value })} />
                  </div>
                </>
              )}
            </>
          )}

          {activeSection === 'cta' && (
            <>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <input type="checkbox" checked={!!value.cta_button}
                  onChange={e => upd('cta_button', e.target.checked ? { text: 'ACESSAR PORTAL', url: '{{portal_os_link}}', style: 'success' } : undefined)} />
                Mostrar botão CTA
              </label>
              {value.cta_button && (
                <>
                  <div>
                    <label className={labelCls}>Texto do botão</label>
                    <input className={inputCls} value={value.cta_button.text}
                      onChange={e => upd('cta_button', { ...value.cta_button!, text: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>URL ou variável</label>
                    <input className={inputCls} value={value.cta_button.url}
                      onChange={e => upd('cta_button', { ...value.cta_button!, url: e.target.value })}
                      placeholder="{{portal_os_link}}" />
                  </div>
                  <div>
                    <label className={labelCls}>Cor</label>
                    <select className={inputCls} value={value.cta_button.style}
                      onChange={e => upd('cta_button', { ...value.cta_button!, style: e.target.value as any })}>
                      {BUTTON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Texto auxiliar abaixo do botão (opcional)</label>
                    <input className={inputCls} value={value.secondary_text || ''}
                      onChange={e => upd('secondary_text', e.target.value)}
                      placeholder="Você entra direto, sem precisar de senha." />
                  </div>
                </>
              )}
            </>
          )}

          {activeSection === 'closing' && (
            <div>
              <label className={labelCls}>Texto de encerramento</label>
              <textarea className={inputCls} rows={3} value={value.closing || ''}
                onChange={e => upd('closing', e.target.value)}
                placeholder="Obrigado pela atenção! 🙏" />
            </div>
          )}

          {activeSection === 'signature' && (
            <>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <input type="checkbox" checked={!!value.signature}
                  onChange={e => upd('signature', e.target.checked ? { company_name: '{{company_name}}' } : undefined)} />
                Mostrar assinatura/rodapé
              </label>
              {value.signature && (
                <>
                  <div>
                    <label className={labelCls}>Nome da empresa</label>
                    <input className={inputCls} value={value.signature.company_name}
                      onChange={e => upd('signature', { ...value.signature!, company_name: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Subtítulo (opcional)</label>
                    <input className={inputCls} value={value.signature.company_subtitle || ''}
                      onChange={e => upd('signature', { ...value.signature!, company_subtitle: e.target.value })}
                      placeholder="Assistência Técnica em Informática" />
                  </div>
                  <div>
                    <label className={labelCls}>Telefone (opcional)</label>
                    <input className={inputCls} value={value.signature.company_phone || ''}
                      onChange={e => upd('signature', { ...value.signature!, company_phone: e.target.value })}
                      placeholder="{{company_phone}}" />
                  </div>
                  <div>
                    <label className={labelCls}>Aviso final (opcional)</label>
                    <textarea className={inputCls} rows={2} value={value.signature.disclaimer || ''}
                      onChange={e => upd('signature', { ...value.signature!, disclaimer: e.target.value })} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── PREVIEW ────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500">Preview ao vivo:</p>
        <div className="rounded-lg border bg-gray-100 p-2 sticky top-4 max-h-[800px] overflow-auto">
          <iframe
            title="Preview"
            srcDoc={previewHtml}
            sandbox=""
            className="w-full bg-white rounded-md"
            style={{ minHeight: '700px', border: 'none' }}
          />
        </div>
      </div>
    </div>
  )
}
