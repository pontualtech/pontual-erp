'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { cn, formatDocument } from '@/lib/utils'
import {
  ArrowLeft, FileText, Plus, Download, XCircle, Edit3, RotateCcw,
  Loader2, Filter, ChevronLeft, ChevronRight, Search,
  AlertTriangle, Home, Mail, Trash2, Eye, Copy, X,
  CheckCircle2, Clock, Ban, FileWarning, ChevronDown, ChevronUp, Printer,
} from 'lucide-react'
import { toast } from 'sonner'

// ============================================================
// Types
// ============================================================

interface Nota {
  id: string
  invoice_number: number | null
  series: string | null
  invoice_type: string
  status: string
  total_amount: number
  tax_amount: number
  issued_at: string | null
  created_at: string
  authorized_at?: string | null
  cancelled_at?: string | null
  access_key: string | null
  danfe_url: string | null
  xml_url: string | null
  provider_ref: string | null
  notes: string | null
  customers: { id: string; legal_name: string; document_number: string | null; email?: string | null } | null
  _count: { invoice_items: number }
}

interface NotaDetail extends Nota {
  invoice_items: {
    id: string
    description: string
    quantity: number
    unit_price: number
    total_price: number
    ncm: string | null
    cfop: string | null
    products?: { id: string; name: string; internal_code: string | null } | null
  }[]
  fiscal_logs: {
    id: string
    action: string
    created_at: string
    response?: any
    request?: any
    status_code?: number | null
  }[]
}

// ============================================================
// SEFAZ Rejection Translator
// ============================================================

const SEFAZ_REJECTION_MAP: Record<string, string> = {
  '204': 'Duplicidade de NF-e: ja existe uma nota com este numero e serie.',
  '205': 'NF-e esta denegada na base de dados da SEFAZ.',
  '206': 'NF-e ja esta inutilizada na base de dados da SEFAZ.',
  '207': 'CNPJ do emitente nao esta cadastrado na SEFAZ.',
  '208': 'CNPJ do destinatario nao esta cadastrado na SEFAZ.',
  '209': 'Inscricao Estadual do emitente invalida.',
  '210': 'Inscricao Estadual do destinatario invalida.',
  '215': 'Rejeicao: Falha no schema XML da NF-e.',
  '225': 'Falha no Schema XML. Verifique se todos os campos obrigatorios estao preenchidos corretamente.',
  '226': 'Codigo de municipio do emitente divergente da UF.',
  '227': 'Codigo de municipio do destinatario divergente da UF.',
  '228': 'Data de emissao futura nao permitida.',
  '233': 'NCM do item nao existe na tabela vigente.',
  '234': 'CFOP invalido para a operacao.',
  '236': 'Chave de acesso invalida (erro no calculo do digito verificador).',
  '239': 'Versao do XML nao suportada.',
  '243': 'Codigo do pais do emitente nao confere.',
  '252': 'Ambiente informado diverge do ambiente do webservice.',
  '301': 'XML assinado com problemas. Verifique se o certificado digital esta valido e autorizado para este CNPJ.',
  '302': 'Certificado digital revogado ou invalido.',
  '303': 'Certificado digital nao e do tipo e-CNPJ ou e-CPF.',
  '450': 'Modelo do documento diferente de 55 (NF-e).',
  '501': 'Erro de timeout na comunicacao com a SEFAZ. Tente novamente.',
  '502': 'Erro na comunicacao com a SEFAZ. Servico indisponivel.',
  '539': 'Duplicidade de numero de NF-e para esta serie.',
  '540': 'CFOP de entrada para NF-e de saida (ou vice-versa).',
  '541': 'Operacao interestadual e CFOP de operacao interna.',
  '550': 'Valor total dos produtos difere do somatorio dos itens.',
  '564': 'Total da NF-e difere do somatorio dos valores.',
  '587': 'Informar dados do transportador para frete por conta do emitente.',
  '593': 'CNPJ/CPF do destinatario invalido.',
  '600': 'Nota rejeitada por contingencia. Tente novamente em alguns minutos.',
  '611': 'CFOP de devolucao exige NF-e referenciada.',
  '613': 'Chave de acesso da NF-e referenciada invalida.',
  '660': 'Valor do ICMS difere do calculado (base x aliquota).',
  '694': 'Nao informado o endereco do destinatario.',
  '778': 'NCM informado nao existe na tabela vigente. Corrija o codigo NCM do produto.',
  '999': 'Rejeicao nao catalogada. Verifique os dados e tente novamente.',
}

const SEFAZ_SSL_ERRORS: Record<string, string> = {
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY': 'Erro de certificado SSL ao conectar com a SEFAZ. Contate o suporte.',
  'CERT_HAS_EXPIRED': 'O certificado digital expirou. Renove seu certificado A1/A3.',
  'ERR_TLS_CERT_ALTNAME_INVALID': 'Erro no certificado TLS da SEFAZ. Tente novamente mais tarde.',
  'ECONNREFUSED': 'Conexao recusada pela SEFAZ. O servico pode estar fora do ar.',
  'ETIMEDOUT': 'Timeout na conexao com a SEFAZ. Tente novamente.',
}

function translateSefazRejection(code: number | string, message: string): string {
  const codeStr = String(code)

  // Check direct code mapping
  if (SEFAZ_REJECTION_MAP[codeStr]) {
    return SEFAZ_REJECTION_MAP[codeStr]
  }

  // Check SSL/connection errors
  for (const [key, translation] of Object.entries(SEFAZ_SSL_ERRORS)) {
    if (message.toUpperCase().includes(key)) {
      return translation
    }
  }

  // Fallback: return original message cleaned up
  if (message) {
    return message.replace(/^Rejeicao:\s*/i, '').trim()
  }

  return 'Erro desconhecido. Verifique os dados da nota e tente novamente.'
}

function extractRejectionInfo(notes: string | null): { code: string; message: string; translated: string } | null {
  if (!notes) return null
  // Pattern: "Erro Focus NFe: [code] message" or "cStat: XXX motivo: YYY"
  const codeMatch = notes.match(/(?:cStat[:\s]*|Rejeicao[:\s]*|Erro[:\s]*|code[:\s]*)(\d{3})/i)
  const code = codeMatch?.[1] || '0'
  const msgMatch = notes.match(/(?:motivo[:\s]*|mensagem[:\s]*|Erro Focus NFe[:\s]*)(.+)/i)
  const message = msgMatch?.[1]?.trim() || notes
  return {
    code,
    message,
    translated: translateSefazRejection(code, message),
  }
}

// ============================================================
// Helpers
// ============================================================

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  AUTHORIZED: { label: 'Autorizada', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  REJECTED: { label: 'Rejeitada', color: 'bg-red-50 text-red-700 border-red-200', icon: XCircle },
  PROCESSING: { label: 'Processando', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock },
  CANCELLED: { label: 'Cancelada', color: 'bg-gray-100 text-gray-600 border-gray-200', icon: Ban },
  ERROR: { label: 'Erro', color: 'bg-red-50 text-red-700 border-red-200', icon: FileWarning },
  DRAFT: { label: 'Rascunho', color: 'bg-gray-50 text-gray-500 border-gray-200', icon: FileText },
  CCE: { label: 'CCe', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: Edit3 },
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function extractNatureza(notes: string | null): string {
  if (!notes) return '---'
  const match = notes.match(/\]\s*(.+?)(?:\s*\||$)/)
  if (match) return match[1].trim()
  const match2 = notes.match(/- (.+?)(?:\s*\||$)/)
  if (match2) return match2[1].trim()
  return notes.split('|')[0].trim().substring(0, 40)
}

function formatDate(date: string | null | undefined): string {
  if (!date) return '---'
  return new Date(date).toLocaleDateString('pt-BR')
}

function formatDateTime(date: string | null | undefined): string {
  if (!date) return '---'
  return new Date(date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copiado!'),
    () => toast.error('Erro ao copiar'),
  )
}

// ============================================================
// KPI Cards
// ============================================================

function KpiCards({ notas }: { notas: Nota[] }) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const thisMonth = notas // API already filtered, but we double-check for month
  const totalEmitidas = thisMonth.length
  const faturamento = thisMonth
    .filter(n => n.status === 'AUTHORIZED')
    .reduce((sum, n) => sum + (n.total_amount ?? 0), 0)
  const rejeitadas = thisMonth.filter(n => n.status === 'REJECTED' || n.status === 'ERROR').length
  const canceladas = thisMonth.filter(n => n.status === 'CANCELLED').length

  const cards = [
    {
      title: 'Total NF-e (mes)',
      value: String(totalEmitidas),
      color: 'text-gray-900',
      bg: 'bg-white',
      icon: FileText,
      iconColor: 'text-blue-500',
    },
    {
      title: 'Faturamento NF-e',
      value: formatCurrency(faturamento),
      color: 'text-emerald-700',
      bg: 'bg-white',
      icon: CheckCircle2,
      iconColor: 'text-emerald-500',
    },
    {
      title: 'Rejeitadas',
      value: String(rejeitadas),
      color: rejeitadas > 0 ? 'text-red-700' : 'text-gray-900',
      bg: rejeitadas > 0 ? 'bg-red-50' : 'bg-white',
      icon: XCircle,
      iconColor: rejeitadas > 0 ? 'text-red-500' : 'text-gray-400',
    },
    {
      title: 'Canceladas',
      value: String(canceladas),
      color: 'text-gray-700',
      bg: 'bg-white',
      icon: Ban,
      iconColor: 'text-gray-400',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map(c => (
        <div key={c.title} className={cn('rounded-xl border p-4 shadow-sm', c.bg)}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{c.title}</p>
            <c.icon className={cn('h-5 w-5', c.iconColor)} />
          </div>
          <p className={cn('mt-2 text-2xl font-bold', c.color)}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// Cancel Modal
// ============================================================

function CancelModal({
  nota,
  onClose,
  onSuccess,
}: {
  nota: Nota
  onClose: () => void
  onSuccess: () => void
}) {
  const [justificativa, setJustificativa] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCancel() {
    if (justificativa.length < 15) return
    setLoading(true)
    try {
      const res = await fetch('/api/fiscal/nfe-cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: nota.id, justificativa }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao cancelar NF-e')
        return
      }
      if (data.data?.cancelado) {
        toast.success(`NF-e #${nota.invoice_number} cancelada com sucesso!`)
        onSuccess()
      } else {
        toast.error(`Cancelamento rejeitado: ${data.data?.motivo || 'Motivo desconhecido'}`)
      }
    } catch {
      toast.error('Erro de conexao com o servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
            <XCircle className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Cancelar NF-e</h3>
            <p className="text-sm text-gray-500">
              NF-e {nota.invoice_number ? `#${nota.invoice_number}` : '---'} - {nota.customers?.legal_name || '---'}
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 mb-4">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
          Esta acao e irreversivel. A NF-e cancelada sera registrada na SEFAZ e o estoque sera estornado.
        </div>
        <div className="mb-4">
          <label htmlFor="cancel-justificativa" className="block text-sm font-medium text-gray-700 mb-1">
            Justificativa do cancelamento
          </label>
          <textarea
            id="cancel-justificativa"
            rows={3}
            placeholder="Informe o motivo do cancelamento (minimo 15 caracteres)..."
            value={justificativa}
            onChange={e => setJustificativa(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 resize-none"
          />
          <p className="mt-1 text-xs text-gray-400">{justificativa.length}/15 caracteres minimos</p>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Voltar
          </button>
          <button type="button" onClick={handleCancel}
            disabled={justificativa.length < 15 || loading}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            Confirmar Cancelamento
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// CCe Modal
// ============================================================

function CceModal({
  nota,
  onClose,
  onSuccess,
}: {
  nota: Nota
  onClose: () => void
  onSuccess: () => void
}) {
  const [correcao, setCorrecao] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCce() {
    if (correcao.length < 15) return
    setLoading(true)
    try {
      const res = await fetch('/api/fiscal/nfe-cce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: nota.id, correcao }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao enviar Carta de Correcao')
        return
      }
      if (data.data?.aceito) {
        toast.success(`Carta de Correcao registrada (Seq. ${data.data.sequencial})`)
        onSuccess()
      } else {
        toast.error(`CCe rejeitada: ${data.data?.motivo || 'Motivo desconhecido'}`)
      }
    } catch {
      toast.error('Erro de conexao com o servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
            <Edit3 className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Carta de Correcao Eletronica</h3>
            <p className="text-sm text-gray-500">
              NF-e {nota.invoice_number ? `#${nota.invoice_number}` : '---'} - {nota.customers?.legal_name || '---'}
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 mb-4">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
          A CCe nao pode corrigir valores, base de calculo, aliquota, quantidade, dados cadastrais do remetente/destinatario ou data de emissao.
        </div>
        <div className="mb-4">
          <label htmlFor="cce-correcao" className="block text-sm font-medium text-gray-700 mb-1">
            Texto da correcao
          </label>
          <textarea
            id="cce-correcao"
            rows={4}
            placeholder="Descreva a correcao a ser feita (minimo 15 caracteres)..."
            value={correcao}
            onChange={e => setCorrecao(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <p className="mt-1 text-xs text-gray-400">{correcao.length}/15 caracteres minimos</p>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button type="button" onClick={handleCce}
            disabled={correcao.length < 15 || loading}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit3 className="h-4 w-4" />}
            Enviar Carta de Correcao
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Email Modal
// ============================================================

function EmailModal({
  nota,
  onClose,
}: {
  nota: Nota
  onClose: () => void
}) {
  const [email, setEmail] = useState(nota.customers?.email || '')
  const [loading, setLoading] = useState(false)

  async function handleSend() {
    if (!email) return
    setLoading(true)
    try {
      const res = await fetch(`/api/fiscal/nfe/${nota.id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`DANFE enviada para ${email}`)
        onClose()
      } else {
        toast.error(data.error || 'Erro ao enviar email')
      }
    } catch {
      toast.error('Erro ao enviar email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
            <Mail className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Enviar NF-e por Email</h3>
            <p className="text-sm text-gray-500">
              NF-e {nota.invoice_number ? `#${nota.invoice_number}` : '---'}
            </p>
          </div>
        </div>
        <div className="mb-4">
          <label htmlFor="email-to" className="block text-sm font-medium text-gray-700 mb-1">
            Email do destinatario
          </label>
          <input
            id="email-to"
            type="email"
            placeholder="email@exemplo.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button type="button" onClick={handleSend}
            disabled={!email || loading}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Enviar
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Detail Slide-over Panel
// ============================================================

function DetailPanel({
  notaId,
  onClose,
}: {
  notaId: string
  onClose: () => void
}) {
  const [detail, setDetail] = useState<NotaDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [showXml, setShowXml] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/fiscal/nfe/${notaId}`)
      .then(r => r.json())
      .then(d => setDetail(d.data ?? null))
      .catch(() => toast.error('Erro ao carregar detalhes'))
      .finally(() => setLoading(false))
  }, [notaId])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const sc = detail ? statusConfig[detail.status] || statusConfig.DRAFT : statusConfig.DRAFT

  // Build timeline events
  function buildTimeline() {
    if (!detail) return []
    const events: { label: string; date: string; color: string; icon: typeof CheckCircle2 }[] = []

    events.push({
      label: 'Emitida',
      date: formatDateTime(detail.issued_at || detail.created_at),
      color: 'text-blue-600',
      icon: FileText,
    })

    if (detail.status === 'AUTHORIZED' || detail.authorized_at) {
      events.push({
        label: 'Autorizada',
        date: formatDateTime(detail.authorized_at || detail.issued_at),
        color: 'text-emerald-600',
        icon: CheckCircle2,
      })
    }

    if (detail.status === 'REJECTED' || detail.status === 'ERROR') {
      events.push({
        label: 'Rejeitada',
        date: formatDateTime(detail.created_at),
        color: 'text-red-600',
        icon: XCircle,
      })
    }

    // Check for CCe events in logs
    const cceEvents = detail.fiscal_logs?.filter(l => l.action.includes('cce') || l.action.includes('CCE')) || []
    for (const cce of cceEvents) {
      events.push({
        label: 'Carta de Correcao',
        date: formatDateTime(cce.created_at),
        color: 'text-blue-600',
        icon: Edit3,
      })
    }

    if (detail.status === 'CANCELLED') {
      events.push({
        label: 'Cancelada',
        date: formatDateTime(detail.cancelled_at || detail.created_at),
        color: 'text-gray-600',
        icon: Ban,
      })
    }

    return events
  }

  const timeline = buildTimeline()

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto bg-white shadow-2xl border-l"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              NF-e {detail?.invoice_number ? `#${detail.invoice_number}` : '---'}
            </h2>
            <p className="text-sm text-gray-500">
              Serie {detail?.series || '1'} - {detail?.customers?.legal_name || '---'}
            </p>
          </div>
          <button type="button" onClick={onClose} title="Fechar painel"
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : !detail ? (
          <div className="px-6 py-20 text-center text-gray-500">
            Nota nao encontrada
          </div>
        ) : (
          <div className="divide-y">
            {/* Status + Rejection */}
            <div className="px-6 py-4">
              <div className="flex items-center gap-3 mb-3">
                <span className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium',
                  sc.color,
                )}>
                  {detail.status === 'PROCESSING' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <sc.icon className="h-3.5 w-3.5" />
                  {sc.label}
                </span>
              </div>

              {/* Rejection alert */}
              {(detail.status === 'REJECTED' || detail.status === 'ERROR') && detail.notes && (() => {
                const info = extractRejectionInfo(detail.notes)
                if (!info) return null
                return (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-sm font-medium text-red-800">{info.translated}</p>
                    <p className="mt-1 text-xs text-gray-500">Codigo SEFAZ: {info.code} - {info.message}</p>
                  </div>
                )
              })()}
            </div>

            {/* Chave de Acesso */}
            {detail.access_key && (
              <div className="px-6 py-4">
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Chave de Acesso</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg bg-gray-50 px-3 py-2 text-xs font-mono text-gray-700 break-all">
                    {detail.access_key}
                  </code>
                  <button type="button" onClick={() => copyToClipboard(detail.access_key!)}
                    className="shrink-0 rounded-lg border p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                    title="Copiar chave">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Emitente / Destinatario */}
            <div className="px-6 py-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Destinatario</p>
                <p className="text-sm font-medium text-gray-900">{detail.customers?.legal_name || '---'}</p>
                <p className="text-xs text-gray-500">{formatDocument(detail.customers?.document_number)}</p>
                {detail.customers?.email && (
                  <p className="text-xs text-gray-500 mt-0.5">{detail.customers.email}</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Informacoes</p>
                <p className="text-xs text-gray-600">Natureza: {extractNatureza(detail.notes)}</p>
                <p className="text-xs text-gray-600">Data: {formatDate(detail.issued_at || detail.created_at)}</p>
                <p className="text-xs text-gray-600">Valor: {formatCurrency(detail.total_amount ?? 0)}</p>
              </div>
            </div>

            {/* Items */}
            <div className="px-6 py-4">
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">
                Itens ({detail.invoice_items?.length || 0})
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs font-medium text-gray-500">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Descricao</th>
                      <th className="px-3 py-2 text-right">Qtd</th>
                      <th className="px-3 py-2 text-right">Unit.</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {detail.invoice_items?.map((item, idx) => (
                      <tr key={item.id} className="text-gray-700">
                        <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium">{item.description}</p>
                          {item.ncm && <p className="text-gray-400">NCM: {item.ncm} | CFOP: {item.cfop || '---'}</p>}
                        </td>
                        <td className="px-3 py-2 text-right">{item.quantity}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(item.unit_price)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.total_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-gray-50 font-medium text-gray-900">
                      <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(detail.total_amount ?? 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Timeline */}
            <div className="px-6 py-4">
              <p className="text-xs font-medium text-gray-500 uppercase mb-3">Timeline</p>
              <div className="space-y-3">
                {timeline.map((ev, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div className={cn('mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-gray-100', ev.color)}>
                      <ev.icon className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{ev.label}</p>
                      <p className="text-xs text-gray-500">{ev.date}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Raw XML Viewer */}
            {detail.xml_url && (
              <div className="px-6 py-4">
                <button
                  type="button"
                  onClick={() => setShowXml(!showXml)}
                  className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase hover:text-gray-700"
                >
                  {showXml ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  XML da Nota
                </button>
                {showXml && (
                  <div className="mt-2">
                    <a
                      href={detail.xml_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" /> Baixar XML completo
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Fiscal Logs */}
            {detail.fiscal_logs && detail.fiscal_logs.length > 0 && (
              <div className="px-6 py-4">
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Logs Fiscais</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {detail.fiscal_logs.map(log => (
                    <div key={log.id} className="flex items-center justify-between text-xs text-gray-500">
                      <span className="font-mono">{log.action}</span>
                      <span>{formatDateTime(log.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ============================================================
// Status Badge Component
// ============================================================

function StatusBadge({ status, notes }: { status: string; notes: string | null }) {
  const sc = statusConfig[status] || statusConfig.DRAFT
  const rejection = (status === 'REJECTED' || status === 'ERROR') ? extractRejectionInfo(notes) : null

  return (
    <div>
      <span className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        sc.color,
      )}>
        {status === 'PROCESSING' && <Loader2 className="h-3 w-3 animate-spin" />}
        <sc.icon className="h-3 w-3" />
        {sc.label}
      </span>
      {rejection && (
        <div className="mt-1 max-w-[250px]">
          <p className="text-xs text-red-600 line-clamp-2" title={rejection.translated}>
            {rejection.translated}
          </p>
          <p className="text-[10px] text-gray-400">Cod. {rejection.code}</p>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Main Component
// ============================================================

export default function NfeListPage() {
  const [notas, setNotas] = useState<Nota[]>([])
  const [allNotas, setAllNotas] = useState<Nota[]>([]) // for KPIs (current page data)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // Modals
  const [cancelNota, setCancelNota] = useState<Nota | null>(null)
  const [cceNota, setCceNota] = useState<Nota | null>(null)
  const [emailNota, setEmailNota] = useState<Nota | null>(null)
  const [detailNotaId, setDetailNotaId] = useState<string | null>(null)

  const loadNotas = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (statusFilter) params.set('status', statusFilter)
    if (searchTerm) params.set('search', searchTerm)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)

    fetch(`/api/fiscal/nfe?${params}`)
      .then(r => r.json())
      .then(d => {
        const data = d.data ?? []
        setNotas(data)
        setAllNotas(data)
        setTotalPages(d.totalPages ?? 1)
        setTotal(d.total ?? 0)
      })
      .catch(() => toast.error('Erro ao carregar NF-e'))
      .finally(() => setLoading(false))
  }, [statusFilter, searchTerm, startDate, endDate, page])

  useEffect(() => {
    loadNotas()
  }, [loadNotas])

  // Debounced search
  const [searchInput, setSearchInput] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Delete rejected note
  async function handleDelete(nota: Nota) {
    if (!confirm(`Excluir NF-e ${nota.invoice_number ? `#${nota.invoice_number}` : nota.id.slice(0, 8)}?`)) return
    try {
      const res = await fetch(`/api/fiscal/nfe/${nota.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ justificativa: 'Exclusao de nota rejeitada' }) })
      if (res.ok) {
        toast.success('NF-e excluida')
        loadNotas()
      } else {
        const d = await res.json()
        toast.error(d.error || 'Erro ao excluir')
      }
    } catch {
      toast.error('Erro de conexao')
    }
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <Link href="/" className="hover:text-gray-600 flex items-center gap-1">
          <Home className="h-3.5 w-3.5" /> Inicio
        </Link>
        <span>/</span>
        <Link href="/fiscal" className="hover:text-gray-600">Fiscal</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">NF-e</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/fiscal" className="rounded-lg border p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">NF-e Emitidas</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Notas Fiscais Eletronicas de Produto (Modelo 55)
            </p>
          </div>
        </div>
        <Link
          href="/fiscal/nfe/emitir"
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Emitir NF-e
        </Link>
      </div>

      {/* KPI Cards */}
      <KpiCards notas={allNotas} />

      {/* Filters */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por cliente, numero ou chave..."
              aria-label="Buscar NF-e"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              aria-label="Filtrar por status"
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              className="rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              <option value="">Todas</option>
              <option value="AUTHORIZED">Autorizadas</option>
              <option value="REJECTED">Rejeitadas</option>
              <option value="CANCELLED">Canceladas</option>
              <option value="PROCESSING">Processando</option>
              <option value="DRAFT">Rascunho</option>
              <option value="ERROR">Erro</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="nfe-start" className="text-sm text-gray-500">De</label>
            <input id="nfe-start" type="date" value={startDate}
              onChange={e => { setStartDate(e.target.value); setPage(1) }}
              className="rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="nfe-end" className="text-sm text-gray-500">Ate</label>
            <input id="nfe-end" type="date" value={endDate}
              onChange={e => { setEndDate(e.target.value); setPage(1) }}
              className="rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>

          {(statusFilter || startDate || endDate || searchInput) && (
            <button type="button"
              onClick={() => { setStatusFilter(''); setStartDate(''); setEndDate(''); setSearchInput(''); setPage(1) }}
              className="text-sm text-blue-600 hover:underline">
              Limpar filtros
            </button>
          )}

          <span className="ml-auto text-sm text-gray-400">
            {total} nota{total !== 1 ? 's' : ''} encontrada{total !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Numero</th>
              <th className="px-4 py-3">Serie</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">CNPJ/CPF</th>
              <th className="px-4 py-3">Natureza</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-16 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
                  <p className="mt-2 text-sm text-gray-400">Carregando NF-e...</p>
                </td>
              </tr>
            ) : notas.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-16 text-center">
                  <FileText className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-3 text-sm font-medium text-gray-500">Nenhuma NF-e encontrada</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {statusFilter || startDate || endDate || searchInput
                      ? 'Tente alterar os filtros aplicados'
                      : 'Emita sua primeira NF-e clicando no botao acima'}
                  </p>
                  {!statusFilter && !startDate && !endDate && !searchInput && (
                    <Link href="/fiscal/nfe/emitir"
                      className="mt-4 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                      <Plus className="h-4 w-4" /> Emitir primeira NF-e
                    </Link>
                  )}
                </td>
              </tr>
            ) : (
              notas.map(n => (
                <tr
                  key={n.id}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => setDetailNotaId(n.id)}
                >
                  <td className="px-4 py-3">
                    <span className="font-semibold text-gray-900">
                      {n.invoice_number || '---'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {n.series || '1'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDate(n.issued_at || n.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 truncate max-w-[180px]">
                      {n.customers?.legal_name ?? '---'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {formatDocument(n.customers?.document_number)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-gray-600 text-xs truncate block max-w-[150px]">
                      {extractNatureza(n.notes)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {formatCurrency(n.total_amount ?? 0)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={n.status} notes={n.notes} />
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-0.5">
                      {/* === AUTHORIZED actions === */}
                      {n.status === 'AUTHORIZED' && (
                        <>
                          {/* DANFE */}
                          <a href={`/api/fiscal/nfe/${n.id}/danfe`} target="_blank" rel="noopener noreferrer" title="Imprimir DANFE"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                            <Printer className="h-4 w-4" />
                          </a>

                          {/* XML */}
                          <a href={n.xml_url || `/api/fiscal/nfe/${n.id}/xml`} target="_blank" rel="noopener noreferrer" title="Baixar XML"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-green-50 hover:text-green-600 transition-colors">
                            <Download className="h-4 w-4" />
                          </a>

                          {/* Email */}
                          <button type="button" onClick={() => setEmailNota(n)} title="Enviar por Email"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-purple-50 hover:text-purple-600 transition-colors">
                            <Mail className="h-4 w-4" />
                          </button>

                          {/* CCe */}
                          <button type="button" onClick={() => setCceNota(n)} title="Carta de Correcao"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors">
                            <Edit3 className="h-4 w-4" />
                          </button>

                          {/* Cancel */}
                          <button type="button" onClick={() => setCancelNota(n)} title="Cancelar NF-e"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                            <XCircle className="h-4 w-4" />
                          </button>
                        </>
                      )}

                      {/* === REJECTED / ERROR actions === */}
                      {(n.status === 'REJECTED' || n.status === 'ERROR') && (
                        <>
                          {/* Reenviar */}
                          <Link href={`/fiscal/nfe/emitir?reemitir=${n.id}`} title="Editar e Reenviar"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-orange-50 hover:text-orange-600 transition-colors">
                            <RotateCcw className="h-4 w-4" />
                          </Link>

                          {/* Ver Motivo */}
                          <button type="button" title="Ver Motivo da Rejeicao"
                            onClick={() => {
                              const info = extractRejectionInfo(n.notes)
                              if (info) {
                                toast.error(info.translated, { description: `Codigo SEFAZ: ${info.code}`, duration: 8000 })
                              } else {
                                toast.error(n.notes || 'Sem detalhes')
                              }
                            }}
                            className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                            <AlertTriangle className="h-4 w-4" />
                          </button>

                          {/* Excluir */}
                          <button type="button" onClick={() => handleDelete(n)} title="Excluir"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}

                      {/* === CANCELLED actions === */}
                      {n.status === 'CANCELLED' && (
                        <>
                          <a href={`/api/fiscal/nfe/${n.id}/danfe`} target="_blank" rel="noopener noreferrer" title="Ver DANFE (cancelamento)"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                            <Printer className="h-4 w-4" />
                          </a>
                          <a href={n.xml_url || `/api/fiscal/nfe/${n.id}/xml`} target="_blank" rel="noopener noreferrer" title="Baixar XML"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-green-50 hover:text-green-600 transition-colors">
                            <Download className="h-4 w-4" />
                          </a>
                        </>
                      )}

                      {/* === PROCESSING actions === */}
                      {n.status === 'PROCESSING' && (
                        <button type="button" onClick={() => setDetailNotaId(n.id)} title="Ver detalhes"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                          <Eye className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>
          <span className="text-sm text-gray-500">Pagina {page} de {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40">
            Proxima <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelNota && (
        <CancelModal nota={cancelNota} onClose={() => setCancelNota(null)} onSuccess={() => { setCancelNota(null); loadNotas() }} />
      )}

      {/* CCe Modal */}
      {cceNota && (
        <CceModal nota={cceNota} onClose={() => setCceNota(null)} onSuccess={() => { setCceNota(null); loadNotas() }} />
      )}

      {/* Email Modal */}
      {emailNota && (
        <EmailModal nota={emailNota} onClose={() => setEmailNota(null)} />
      )}

      {/* Detail Slide-over */}
      {detailNotaId && (
        <DetailPanel notaId={detailNotaId} onClose={() => setDetailNotaId(null)} />
      )}
    </div>
  )
}
