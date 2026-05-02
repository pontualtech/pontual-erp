'use client'

import { useState, useEffect, useRef } from 'react'
import { FileText, ChevronDown } from 'lucide-react'

/**
 * UX-5 #3: snippets/templates de mensagem reusáveis pelo atendente.
 *
 * Versão v1 (S): templates fixos por categoria, salvos em localStorage
 * (chave `erp:snippets`). Próximo passo (Sprint UX-5b): tabela
 * `message_snippets(company_id, key, title, body, category)` + UI de gestão
 * em /config/snippets + slash command `/snippet` em textareas.
 *
 * Uso:
 *   <SnippetPicker
 *     category="orcamento"
 *     onPick={(text) => setMensagem(prev => prev + '\n' + text)}
 *   />
 */
type Snippet = { key: string; title: string; body: string; category: string }

const DEFAULT_SNIPPETS: Snippet[] = [
  { key: 'aprovado_agendar', title: 'Aprovado — vou agendar', body: 'Olá! Seu orçamento foi aprovado. Vou agendar a entrega/coleta e te aviso o horário em breve.', category: 'orcamento' },
  { key: 'orcamento_enviado', title: 'Orçamento enviado', body: 'Olá! Acabei de enviar o orçamento detalhado. Qualquer dúvida estou à disposição. Aguardo seu retorno.', category: 'orcamento' },
  { key: 'pix_enviado', title: 'PIX enviado', body: 'Boa tarde! Acabei de enviar o link PIX. Após o pagamento, é confirmado automaticamente em alguns segundos.', category: 'cobranca' },
  { key: 'boleto_enviado', title: 'Boleto enviado', body: 'Olá! Boleto enviado por email/WhatsApp. Vencimento conforme combinado. Avise se tiver alguma dificuldade.', category: 'cobranca' },
  { key: 'pronto_retirar', title: 'Equipamento pronto', body: 'Equipamento já está pronto para retirada! Funcionamento de seg a sex 8h-18h. Sábado 8h-12h.', category: 'entrega' },
  { key: 'aguardando_peca', title: 'Aguardando peça', body: 'Estamos aguardando a chegada da peça. Previsão: X dias úteis. Avisamos assim que chegar.', category: 'reparo' },
  { key: 'agradecimento', title: 'Agradecimento pós-OS', body: 'Obrigado pela confiança! Se precisar de algo, é só chamar. Pode dar uma estrelinha pra gente no Google? Ajuda muito! 🙏', category: 'geral' },
]

function loadSnippets(): Snippet[] {
  if (typeof window === 'undefined') return DEFAULT_SNIPPETS
  try {
    const raw = localStorage.getItem('erp:snippets')
    if (!raw) return DEFAULT_SNIPPETS
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
  } catch {}
  return DEFAULT_SNIPPETS
}

export function SnippetPicker({
  category,
  onPick,
  buttonLabel = 'Templates',
  compact = false,
}: {
  category?: string
  onPick: (text: string) => void
  buttonLabel?: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [snippets, setSnippets] = useState<Snippet[]>(DEFAULT_SNIPPETS)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSnippets(loadSnippets())
  }, [])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const filtered = category ? snippets.filter((s) => s.category === category || s.category === 'geral') : snippets

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          compact
            ? 'inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50'
            : 'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50'
        }
        title="Inserir template de mensagem"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <FileText className="h-3.5 w-3.5" /> {buttonLabel}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1 z-30 w-[320px] max-h-80 overflow-y-auto rounded-xl border bg-white shadow-lg">
          <div className="px-3 py-2 border-b text-[10px] font-semibold uppercase text-gray-500">
            Templates {category ? `· ${category}` : ''}
          </div>
          {filtered.length === 0 ? (
            <p className="p-3 text-xs text-gray-400">Nenhum template para esta categoria</p>
          ) : (
            filtered.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => { onPick(s.body); setOpen(false) }}
                className="block w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-0"
              >
                <p className="text-sm font-medium text-gray-800 truncate">{s.title}</p>
                <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{s.body}</p>
              </button>
            ))
          )}
          <div className="px-3 py-2 border-t bg-gray-50 text-[10px] text-gray-400">
            <a href="/configuracoes/snippets" className="hover:text-blue-600">⚙ Editar templates</a>
          </div>
        </div>
      )}
    </div>
  )
}
