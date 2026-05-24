'use client'

/**
 * Wave AG-3 (2026-05-24): UI pra editar template "Peças em trânsito" (atraso reparo).
 * Antes era hardcoded em lib/email-templates/atraso-reparo.ts (constante
 * PECAS_EM_TRANSITO). Agora Karlão edita via editor visual de blocos e o cron
 * /api/cron/atraso-reparo carrega setting atraso_reparo.email_template.
 *
 * Fallback: se nada salvo, cron usa o hardcoded.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Save, Loader2, AlertTriangle, RotateCcw } from 'lucide-react'
import { EmailBlocksEditor } from '@/app/(dashboard)/components/email-blocks-editor'
import {
  renderEmailFromBlocks,
  embedBlocksInHtml,
  extractBlocksFromHtml,
  DEFAULT_PECAS_EM_TRANSITO_BLOCKS,
  type EmailBlocks,
} from '@/lib/email-templates/blocks-renderer'

const AVAILABLE_VARS = [
  { key: 'primeiro_nome', desc: 'Primeiro nome do cliente' },
  { key: 'empresa', desc: 'Nome da empresa' },
  { key: 'os_number', desc: 'Número da OS' },
  { key: 'equipamento_completo', desc: 'Equipamento (tipo + marca + modelo)' },
  { key: 'nova_eta', desc: 'Nova data prevista (dd/mm/aaaa)' },
  { key: 'dias_uteis_restantes', desc: 'Dias úteis até a nova ETA' },
  { key: 'link_portal', desc: 'Link mágico do portal do cliente' },
  { key: 'link_suporte', desc: 'Link WhatsApp suporte' },
]

const SAMPLE_VARS: Record<string, string> = {
  primeiro_nome: 'João',
  empresa: 'PontualTech',
  os_number: '60123',
  equipamento_completo: 'Impressora HP LaserJet Pro M404',
  nova_eta: '29/05/2026',
  dias_uteis_restantes: '5',
  link_portal: 'https://portal.pontualtech.com.br/portal/pontualtech/os/exemplo',
  link_suporte: 'https://wa.me/551126263841',
}

const DEFAULT_SUBJECT = 'OS #{{os_number}} — Atualização sobre seu reparo'

export default function AtrasoReparoConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [blocks, setBlocks] = useState<EmailBlocks>(DEFAULT_PECAS_EM_TRANSITO_BLOCKS)
  const [subject, setSubject] = useState(DEFAULT_SUBJECT)
  const [isCustom, setIsCustom] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      if (data.data) {
        const flat: Record<string, string> = {}
        for (const group of Object.values(data.data) as any[]) {
          if (Array.isArray(group)) {
            for (const s of group) if (s.key && s.value !== undefined) flat[s.key] = s.value
          } else if (group && typeof group === 'object') {
            for (const [key, val] of Object.entries(group)) flat[key] = (val as any)?.value ?? ''
          }
        }
        const savedHtml = flat['atraso_reparo.email_template']
        const savedSubject = flat['atraso_reparo.email_subject']
        if (savedSubject) setSubject(savedSubject)
        if (savedHtml) {
          setIsCustom(true)
          const embedded = extractBlocksFromHtml(savedHtml)
          if (embedded) setBlocks(embedded)
        }
      }
    } catch { toast.error('Falha ao carregar') }
    finally { setLoading(false) }
  }

  async function save() {
    setSaving(true)
    try {
      const generatedHtml = renderEmailFromBlocks(blocks)
      const htmlWithBlocks = embedBlocksInHtml(generatedHtml, blocks)
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: [
            { key: 'atraso_reparo.email_template', value: htmlWithBlocks, type: 'string', group: 'atraso_reparo' },
            { key: 'atraso_reparo.email_subject', value: subject, type: 'string', group: 'atraso_reparo' },
          ],
        }),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      setIsCustom(true)
      toast.success('Template salvo! Próximo email de atraso vai usar este modelo.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally { setSaving(false) }
  }

  async function resetToDefault() {
    if (!window.confirm('Restaurar template padrão? Suas customizações serão perdidas.')) return
    setResetting(true)
    try {
      // Deletar via PUT com value vazio — endpoint settings padrao
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: [
            { key: 'atraso_reparo.email_template', value: '', type: 'string', group: 'atraso_reparo' },
            { key: 'atraso_reparo.email_subject', value: '', type: 'string', group: 'atraso_reparo' },
          ],
        }),
      })
      if (!res.ok) throw new Error('Erro ao restaurar')
      setBlocks(DEFAULT_PECAS_EM_TRANSITO_BLOCKS)
      setSubject(DEFAULT_SUBJECT)
      setIsCustom(false)
      toast.success('Template restaurado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao restaurar')
    } finally { setResetting(false) }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-gray-400">
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
    </div>
  }

  return (
    <div className="space-y-4 max-w-6xl pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-amber-500" /> Email de Atraso de Reparo
            </h1>
            <p className="text-sm text-gray-500">
              Template usado pelo cron diário quando a OS está em "Aprovado" e o prazo estourou.
              {' '}
              {isCustom
                ? <span className="text-indigo-600 font-medium">Customizado pela empresa</span>
                : <span className="text-gray-400">Usando template padrão</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isCustom && (
            <button type="button" onClick={resetToDefault} disabled={resetting}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <RotateCcw className="w-4 h-4" /> Restaurar padrão
            </button>
          )}
          <button type="button" onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Info card sobre quando dispara */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Quando este email é enviado?</strong>
        <ul className="mt-1 ml-4 list-disc text-xs space-y-0.5">
          <li>OS no status <strong>"Aprovado"</strong> (cliente já aprovou orçamento)</li>
          <li>Prazo previsto (<code className="bg-white px-1 rounded text-[10px]">estimated_delivery</code>) estourou</li>
          <li>Cron diário 08:00 BRT envia 1 email no estouro + define nova ETA (+5 dias úteis)</li>
          <li>Repete a cada novo estouro até OS sair de "Aprovado"</li>
          <li>Apenas PontualTech (Imprimitech tem fluxo próprio)</li>
        </ul>
      </div>

      {/* Assunto */}
      <div className="rounded-xl border bg-white p-4 shadow-sm space-y-2">
        <label htmlFor="atraso-subject" className="text-xs font-medium text-gray-600">Assunto do e-mail</label>
        <input id="atraso-subject" type="text" value={subject} onChange={e => setSubject(e.target.value)}
          placeholder={DEFAULT_SUBJECT}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>

      {/* Editor visual */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="border-b px-4 py-2">
          <h2 className="text-sm font-semibold text-gray-700">Corpo do e-mail — editor visual</h2>
          <p className="text-xs text-gray-500 mt-0.5">Edita os blocos, preview ao lado atualiza ao vivo.</p>
        </div>
        <div className="p-4">
          <EmailBlocksEditor
            value={blocks}
            onChange={setBlocks}
            availableVars={AVAILABLE_VARS}
            sampleVars={SAMPLE_VARS}
          />
        </div>
      </div>
    </div>
  )
}
