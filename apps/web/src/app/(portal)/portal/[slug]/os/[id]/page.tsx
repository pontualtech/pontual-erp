'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Printer, Mail, X, CreditCard, Truck, Clock, Banknote, Zap, CheckCircle2, MessageSquare, Loader2 } from 'lucide-react'
import { PhotoGallery } from '../../../../components/photo-gallery'
import PortalPayBox from './_components/portal-pay-box'

interface OSDetail {
  id: string
  os_number: number
  equipment_type: string
  equipment_brand?: string
  equipment_model?: string
  serial_number?: string
  reported_issue: string
  diagnosis?: string
  priority?: string
  os_type?: string
  estimated_cost?: number
  approved_cost?: number
  total_parts?: number
  total_services?: number
  discount_amount?: number
  total_cost?: number
  custom_data?: Record<string, any>
  is_recalculado?: boolean
  estimated_delivery?: string
  actual_delivery?: string
  warranty_until?: string
  created_at: string
  updated_at: string
  status: { id: string; name: string; color: string; order?: number }
  can_pay?: boolean
  items: Array<{
    id: string
    item_type: string
    description: string
    quantity: number
    unit_price: number
    total_price: number
  }>
  history: Array<{
    id: string
    to_status: { name: string; color: string }
    notes?: string
    created_at: string
  }>
  photos: Array<{
    id: string
    url: string
    label?: string
  }>
  all_statuses: Array<{
    id: string
    name: string
    color: string
    order?: number
  }>
}

export default function PortalOSDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const slug = params.slug as string
  const osId = params.id as string
  const docParam = searchParams.get('doc') || ''
  const accessToken = searchParams.get('access') || ''

  const [os, setOs] = useState<OSDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [approvePayment, setApprovePayment] = useState<string | null>(null)
  const [company, setCompany] = useState<{ name: string; phone?: string; whatsapp?: string; email?: string; address?: string; cnpj?: string; horario?: string; pix_chave?: string; pix_banco?: string; default_business_days?: string } | null>(null)
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null)
  const [npsScore, setNpsScore] = useState<number | null>(null)
  const [npsComment, setNpsComment] = useState('')
  const [npsSubmitted, setNpsSubmitted] = useState(false)
  const [npsExisting, setNpsExisting] = useState<{ score: number; comment?: string } | null>(null)
  const [npsLoading, setNpsLoading] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [showNegotiate, setShowNegotiate] = useState(false)
  const [negotiateReason, setNegotiateReason] = useState('')
  const NEGOTIATE_SUGGESTIONS = [
    'Achei o valor alto',
    'Pode parcelar mais vezes?',
    'Posso tirar alguma peça?',
    'Tem desconto à vista?',
  ]

  function loadOS() {
    // Auth token is sent automatically via httpOnly cookie
    fetch(`/api/portal/os/${osId}`)
      .then(r => {
        if (r.status === 401) {
          const redirect = encodeURIComponent(`/portal/${slug}/os/${osId}`)
          router.push(`/portal/${slug}/login?${docParam ? `doc=${docParam}&` : ''}redirect=${redirect}`)
          return null
        }
        return r.json()
      })
      .then(res => {
        if (res?.data) {
          setOs(res.data)
        } else if (res && !res.data) {
          // OS not found for this customer — redirect to login with doc hint
          const redirect = encodeURIComponent(`/portal/${slug}/os/${osId}`)
          router.push(`/portal/${slug}/login?${docParam ? `doc=${docParam}&` : ''}redirect=${redirect}`)
        }
      })
      .catch(() => toast.error('Erro ao carregar OS'))
      .finally(() => setLoading(false))
  }

  function loadNps() {
    fetch(`/api/portal/nps?service_order_id=${osId}`)
      .then(r => r.json())
      .then(res => {
        if (res?.data) {
          setNpsExisting(res.data)
        }
      })
      .catch(() => {})
  }

  async function handleNpsSubmit() {
    if (npsScore === null) return
    setNpsLoading(true)
    try {
      const res = await fetch('/api/portal/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_order_id: osId,
          score: npsScore,
          comment: npsComment.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao enviar avaliacao')
        return
      }
      toast.success(data.data.message)
      setNpsSubmitted(true)
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setNpsLoading(false)
    }
  }

  useEffect(() => {
    const savedCompany = localStorage.getItem('portal_company')
    const savedCustomer = localStorage.getItem('portal_customer')
    if (savedCompany) try { setCompany(JSON.parse(savedCompany)) } catch {}
    if (savedCustomer) try { setCustomer(JSON.parse(savedCustomer)) } catch {}

    // Magic link: auto-login via access token (no password/OTP needed)
    if (accessToken) {
      fetch('/api/portal/auth/auto-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: accessToken }),
      })
        .then(r => r.json())
        .then(res => {
          if (res?.data) {
            localStorage.setItem('portal_customer', JSON.stringify(res.data.customer))
            localStorage.setItem('portal_company', JSON.stringify(res.data.company))
            setCompany(res.data.company)
            setCustomer(res.data.customer)
          }
          // Load OS regardless (cookie was set by auto-login)
          loadOS()
          if (showNps) loadNps()
        })
        .catch(() => {
          // Token failed — try loading anyway (might have existing cookie)
          loadOS()
          if (showNps) loadNps()
        })
    } else {
      loadOS()
      if (showNps) loadNps()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osId])

  async function handleAction(action: 'approve' | 'reject' | 'comment', message?: string) {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/portal/os/${osId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, message }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao executar acao')
        return
      }

      toast.success(data.data.message)
      setComment('')
      loadOS()
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setActionLoading(false)
    }
  }

  function handlePrint() {
    window.print()
  }

  async function handleSendEmail() {
    if (!emailTo.trim()) {
      toast.error('Informe o email')
      return
    }
    setEmailSending(true)
    try {
      const res = await fetch(`/api/portal/os/${osId}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailTo.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao enviar email')
        return
      }
      toast.success('Email enviado com sucesso!')
      setShowEmailModal(false)
      setEmailTo('')
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setEmailSending(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('portal_customer')
    localStorage.removeItem('portal_company')
    fetch('/api/portal/logout', { method: 'POST' })
      .finally(() => router.push(`/portal/${slug}/login${docParam ? `?doc=${docParam}` : ''}`))
  }

  const isAguardandoAprovacao = os?.status.name.toLowerCase().includes('aguardando') &&
    os?.status.name.toLowerCase().includes('aprov')

  const isRecalculado = os?.is_recalculado || os?.status.name.toLowerCase().includes('recalculad') || false

  const isAprovado = os?.status.name.toLowerCase().includes('aprovado') ||
    os?.status.name.toLowerCase().includes('aprovad')

  const showCondicoesReparo = isAguardandoAprovacao || isAprovado

  const isProntaOuEntregue = os?.status.name.toLowerCase().includes('pronta') ||
    os?.status.name.toLowerCase().includes('entregue')

  const isEntregue = os?.status.name.toLowerCase().includes('entregue')
  // UX-4 #3: NPS reativado (estava hardcoded false). Pesquisa pos-entrega
  // gera signal valioso de qualidade e abre janela pra CTA "review Google".
  const showNps = true
  const showNpsSurvey = showNps && isEntregue && !npsExisting && !npsSubmitted

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!os) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 dark:text-gray-400 mb-4">OS nao encontrada</p>
          <Link href={`/portal/${slug}/os`} className="text-blue-600 dark:text-blue-400 hover:text-blue-700">
            Voltar para lista
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      {/* Print styles */}
      <style>{`
        @media print {
          header, nav, footer,
          .print\\:hidden,
          [data-print-hide] {
            display: none !important;
          }
          body, .min-h-screen {
            background: white !important;
            min-height: auto !important;
          }
          .bg-gray-50 {
            background: white !important;
          }
          main {
            padding: 0 !important;
            max-width: 100% !important;
          }
          .rounded-xl {
            border-radius: 0 !important;
            border: none !important;
            box-shadow: none !important;
          }
          @page {
            margin: 1.5cm;
          }
          .print\\:block {
            display: block !important;
          }
        }
      `}</style>

      {/* Print header - only visible when printing */}
      <div className="hidden print:block text-center mb-6 border-b pb-4">
        <h1 className="text-xl font-bold">{company?.name || slug}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Ordem de Servico #{os.os_number}</p>
      </div>

      {/* Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl dark:shadow-zinc-900/50 w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-lg">Enviar OS por Email</h3>
              <button onClick={() => setShowEmailModal(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email do destinatario</label>
            <input
              type="email"
              value={emailTo}
              onChange={e => setEmailTo(e.target.value)}
              placeholder="email@exemplo.com"
              className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 dark:bg-zinc-800/50"
              onKeyDown={e => e.key === 'Enter' && handleSendEmail()}
              autoFocus
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowEmailModal(false)}
                className="px-4 py-2 border border-gray-300 dark:border-zinc-700 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendEmail}
                disabled={emailSending || !emailTo.trim()}
                className="px-4 py-2 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl text-sm font-medium transition-colors"
              >
                {emailSending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Negociar Orcamento (substitui window.prompt — UX-1 #3) */}
      {showNegotiate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="negotiate-modal-title"
          onClick={() => !actionLoading && setShowNegotiate(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md max-h-[95dvh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-gray-200 dark:border-zinc-700 flex items-center justify-between">
              <h3 id="negotiate-modal-title" className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-amber-600" />
                Quero negociar
              </h3>
              <button
                type="button"
                onClick={() => setShowNegotiate(false)}
                disabled={actionLoading}
                aria-label="Fechar"
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50 p-1 -m-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Conte o que você gostaria de ajustar — vamos entrar em contato para conversar.
              </p>

              <div>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Sugestões rápidas:</p>
                <div className="flex flex-wrap gap-2">
                  {NEGOTIATE_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setNegotiateReason((prev) => prev ? `${prev} ${s}` : s)}
                      className="px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950 hover:bg-amber-100 dark:hover:bg-amber-900 border border-amber-300 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 font-medium"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="negotiate-textarea" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Sua mensagem (opcional)
                </label>
                <textarea
                  id="negotiate-textarea"
                  value={negotiateReason}
                  onChange={(e) => setNegotiateReason(e.target.value)}
                  rows={4}
                  maxLength={500}
                  placeholder="Ex: Posso parcelar em mais vezes? Qual seria o desconto à vista?"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100"
                  autoFocus
                />
                <p className="text-[10px] text-gray-400 mt-1 text-right">{negotiateReason.length}/500</p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowNegotiate(false)}
                  disabled={actionLoading}
                  className="flex-1 px-4 py-3 border border-gray-300 dark:border-zinc-700 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800 text-sm font-semibold disabled:opacity-50 min-h-[44px]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleAction('reject', negotiateReason.trim() || 'Cliente solicitou negociacao')
                    setShowNegotiate(false)
                  }}
                  disabled={actionLoading}
                  className="flex-1 px-4 py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[44px] flex items-center justify-center gap-2"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                  Enviar e aguardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-700 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 dark:bg-blue-500 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{company?.name || slug}</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6">
            <Link href={`/portal/${slug}`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm">Inicio</Link>
            <Link href={`/portal/${slug}/os`} className="text-blue-600 dark:text-blue-400 font-medium text-sm">Minhas OS</Link>
            <Link href={`/portal/${slug}/tickets`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm">Tickets</Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:block">{customer?.name}</span>
            <button onClick={handleLogout} className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 font-medium">Sair</button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-6 print:hidden">
          <Link href={`/portal/${slug}/os`} className="hover:text-gray-700 dark:hover:text-gray-300">Minhas OS</Link>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-900 dark:text-gray-100 font-medium">OS #{os.os_number}</span>
        </div>

        {/* OS Header */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">OS #{os.os_number}</h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1">
                Aberta em {new Date(os.created_at).toLocaleDateString('pt-BR', {
                  day: '2-digit', month: 'long', year: 'numeric'
                })}
              </p>
            </div>
            <div className="flex items-center gap-2 self-start">
              <span
                className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold"
                style={{
                  backgroundColor: `${os.status.color}20`,
                  color: os.status.color,
                }}
              >
                {os.status.name}
              </span>
              <button
                type="button"
                title="Imprimir OS"
                onClick={handlePrint}
                className="print:hidden inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                <Printer className="w-4 h-4" />
                <span className="hidden sm:inline">Imprimir</span>
              </button>
              <button
                type="button"
                title="Enviar por Email"
                onClick={() => setShowEmailModal(true)}
                className="print:hidden inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                <Mail className="w-4 h-4" />
                <span className="hidden sm:inline">Email</span>
              </button>
              {/* UX-8 #3: Web Share API — cliente compartilha OS por WhatsApp/SMS nativo */}
              <button
                type="button"
                title="Compartilhar"
                onClick={async () => {
                  if (!os) return
                  const url = typeof window !== 'undefined' ? window.location.href : ''
                  const shareData = {
                    title: `OS #${os.os_number} — ${company?.name || 'Portal'}`,
                    text: `Acompanhe minha OS #${os.os_number} (${os.equipment_type}): ${os.status.name}`,
                    url,
                  }
                  try {
                    if (typeof navigator !== 'undefined' && (navigator as any).share) {
                      await (navigator as any).share(shareData)
                    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
                      await navigator.clipboard.writeText(url)
                      toast.success('Link copiado!')
                    } else {
                      toast.error('Compartilhamento não suportado neste navegador')
                    }
                  } catch (err: any) {
                    // AbortError = usuário cancelou — silencioso
                    if (err?.name !== 'AbortError') toast.error('Erro ao compartilhar')
                  }
                }}
                className="print:hidden inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                <span className="hidden sm:inline">Compartilhar</span>
              </button>
            </div>
          </div>

          {/* Status Timeline */}
          {os.all_statuses.length > 0 && (() => {
            // Normalizador multi-tenant: "Orçar" (PT) e "Orcar" (IM) viram
            // ambos "orcar" — evita divergir por causa de acento.
            const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

            // Fluxo principal do reparo (caminho feliz, em nomes amigaveis
            // do portal — a API /api/portal/os/[id] ja mapeia internos para
            // esses nomes via PORTAL_LABEL). Qualquer status fora desse set
            // (Renegociar, Entregar Recusado, Cancelada, Laudo etc) e branch
            // e dispara o banner de alerta.
            const MAIN_FLOW = new Set([
              'recebido',
              'coletar',
              'em analise',
              'aguardando aprovacao',
              'em reparo',
              'pronto para retirada',
              'entregue',
            ])
            const isMainFlow = (name: string) => MAIN_FLOW.has(norm(name))

            const mainStatuses = os.all_statuses.filter((s) => isMainFlow(s.name))
            const currentIsBranch = !isMainFlow(os.status.name)

            const historyDateMap: Record<string, string> = {}
            os.history.forEach((h) => {
              historyDateMap[h.to_status.name] = h.created_at
            })
            // Fonte de verdade do "past": historico real de transicoes, nao o
            // campo `order` (nao-unico). `order < currentOrder` marcava Entregue
            // como "past" mesmo em OS que estava em Renegociar — cliente via
            // entrega erroneamente concluida.
            const visitedStatusNames = new Set(os.history.map((h) => h.to_status.name))

            return (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 capitalize mb-3">Progresso</h3>

                {currentIsBranch && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-3 flex items-start gap-2">
                    <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.19 16a2 2 0 001.74 3z" />
                    </svg>
                    <div className="text-sm">
                      <div className="font-semibold text-amber-900 dark:text-amber-200">Atencao: OS em {os.status.name}</div>
                      <div className="text-amber-800 dark:text-amber-300 mt-0.5">
                        Ha uma pendencia fora do fluxo normal de reparo. Verifique as atualizacoes recentes abaixo ou entre em contato com o suporte.
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-0">
                  {mainStatuses.map((s, i) => {
                    const isActive = !currentIsBranch && s.id === os.status.id
                    const isPast = visitedStatusNames.has(s.name) && !isActive
                    const isFuture = !isActive && !isPast
                    const friendlyName = s.name
                    const historyDate = historyDateMap[s.name]

                    return (
                      <div key={s.id} className="flex items-stretch">
                        {/* Left: circle + connecting line */}
                        <div className="flex flex-col items-center mr-3">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
                              isActive ? 'animate-pulse' : ''
                            }`}
                            style={{
                              backgroundColor: isPast ? '#22C55E' : isActive ? (s.color || '#3B82F6') : '#E5E7EB',
                              color: isPast || isActive ? 'white' : '#9CA3AF',
                              boxShadow: isActive ? `0 0 0 4px ${s.color || '#3B82F6'}30` : undefined,
                            }}
                          >
                            {isPast ? (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : isActive ? (
                              <span className="text-base leading-none">&#9679;</span>
                            ) : (
                              <span className="text-base leading-none">&#9675;</span>
                            )}
                          </div>
                          {i < os.all_statuses.length - 1 && (
                            <div
                              className="w-0.5 flex-1 min-h-[24px]"
                              style={{
                                backgroundColor: isPast ? '#22C55E' : '#E5E7EB',
                              }}
                            />
                          )}
                        </div>
                        {/* Right: label + date */}
                        <div
                          className={`pb-4 pt-1 flex-1 ${
                            isActive ? 'bg-blue-50 dark:bg-blue-950 -ml-1 pl-2 pr-2 rounded-lg border border-blue-100 dark:border-blue-900' : ''
                          }`}
                        >
                          <span
                            className={`text-sm leading-tight block ${
                              isActive
                                ? 'font-bold text-gray-900 dark:text-gray-100'
                                : isPast
                                  ? 'font-medium text-gray-700 dark:text-gray-300'
                                  : 'text-gray-400 dark:text-gray-500'
                            }`}
                          >
                            {friendlyName}
                          </span>
                          {isActive && (
                            <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold">Status atual</span>
                          )}
                          {isPast && historyDate && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {new Date(historyDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {isActive && historyDate && (
                            <>
                              <span className="text-xs text-gray-400 dark:text-gray-500 block">
                                Desde {new Date(historyDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {/* UX-6 #3: tempo decorrido visual (tipo iFood "saiu pra entrega há 12min") */}
                              {(() => {
                                const ms = Date.now() - new Date(historyDate).getTime()
                                const min = Math.floor(ms / 60000)
                                if (min < 1) return <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">agora mesmo ⚡</span>
                                if (min < 60) return <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">há {min} min</span>
                                const h = Math.floor(min / 60)
                                if (h < 24) return <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">há {h}h{min % 60 > 0 ? ` ${min % 60}min` : ''}</span>
                                const d = Math.floor(h / 24)
                                if (d < 7) return <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">há {d} dia{d > 1 ? 's' : ''}</span>
                                return <span className="text-xs text-red-600 dark:text-red-400 font-semibold">há {d} dias 🕐</span>
                              })()}
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Equipment Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 capitalize mb-2">Equipamento</h3>
              <p className="text-gray-900 dark:text-gray-100 font-medium">{os.equipment_type}</p>
              {(os.equipment_brand || os.equipment_model) && (
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  {os.equipment_brand} {os.equipment_model}
                </p>
              )}
              {os.serial_number && (
                <p className="text-gray-500 dark:text-gray-400 text-sm">S/N: {os.serial_number}</p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 capitalize mb-2">Problema Relatado</h3>
              <p className="text-gray-700 dark:text-gray-300">{os.reported_issue}</p>
            </div>
            {os.diagnosis && (
              <div className="sm:col-span-2">
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 capitalize mb-2">Diagnostico</h3>
                <p className="text-gray-700 dark:text-gray-300">{os.diagnosis}</p>
              </div>
            )}
            {os.estimated_delivery && (
              <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-400 capitalize mb-2">Previsao de Entrega</h3>
                <p className="text-xl font-bold text-blue-900 dark:text-blue-300">{new Date(os.estimated_delivery).toLocaleDateString('pt-BR')}</p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Prazo maximo de 10 dias uteis apos aprovacao. Sempre tentamos entregar o quanto antes!</p>
              </div>
            )}
            {os.warranty_until && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 capitalize mb-2">Garantia ate</h3>
                <p className="text-gray-900 dark:text-gray-100">{new Date(os.warranty_until).toLocaleDateString('pt-BR')}</p>
              </div>
            )}
          </div>
        </div>

        {/* APROVACAO DO ORCAMENTO — TOPO DA AREA DE ACAO
            Quando OS esta em "Aguardando Aprovacao", esse card aparece
            ACIMA de tudo (so depois de Equipment Info) pra cliente nao
            precisar scrollar pra achar o botao verde. Substitui o card
            de pagamento (que vira redundante — ja mostra formas aqui). */}
        {isAguardandoAprovacao && (() => {
          const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v / 100)
          const paymentOptions = [
            { value: 'PIX', label: 'PIX', icon: '⚡', desc: 'A vista na entrega' },
            { value: 'Dinheiro', label: 'Dinheiro', icon: '💵', desc: 'A vista na entrega' },
            { value: 'Cartao Credito', label: 'Cartao de Credito', icon: '💳', desc: 'Ate 3x sem juros' },
            { value: 'Cartao Debito', label: 'Cartao de Debito', icon: '💳', desc: 'A vista na entrega' },
            { value: 'Boleto', label: 'Boleto Bancario', icon: '📄', desc: 'Somente PJ (7 dias)' },
          ]
          const maxParcelas = isRecalculado ? 5 : 3
          const parcelaValor = fmt(Math.ceil((os.total_cost || 0) / maxParcelas))
          const hasDesconto = (os.discount_amount ?? 0) > 0 || (isRecalculado && (os.custom_data as any)?.original_cost > 0)
          const originalVal = (os.custom_data as any)?.original_cost || ((os.total_services || 0) + (os.total_parts || 0))
          return (
            <div className="relative mb-6" data-print-hide>
              {/* Glow pulse atras do card pra chamar atencao sem ser agressivo */}
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-500 opacity-20 blur-xl [animation:pulse_3s_cubic-bezier(0.4,0,0.6,1)_infinite]" aria-hidden="true"></div>

              <div className={`relative rounded-2xl p-5 sm:p-6 border-2 shadow-lg ${isRecalculado ? 'bg-gradient-to-br from-amber-50 via-orange-50 to-white dark:from-amber-950 dark:via-orange-950 dark:to-gray-900 border-amber-400 dark:border-amber-700' : 'bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/40 dark:to-gray-900 border-amber-300 dark:border-amber-800'}`}>
                {/* Badge topo: AGUARDANDO SUA APROVACAO (ou Nova Proposta se recalculado) */}
                {isRecalculado ? (
                  <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500 text-white px-3 py-1 text-[11px] font-bold uppercase tracking-wider">
                    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                    Nova Proposta Especial
                  </div>
                ) : (
                  <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500 text-white px-3 py-1 text-[11px] font-bold uppercase tracking-wider">
                    <Clock className="h-3.5 w-3.5" />
                    Aguardando sua aprovacao
                  </div>
                )}

                <h3 className="font-extrabold text-gray-900 dark:text-gray-50 text-xl sm:text-2xl mb-1">{isRecalculado ? 'Preparamos uma condicao especial pra voce' : 'Seu orcamento esta pronto!'}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Aprove abaixo para iniciarmos o reparo do seu equipamento.</p>

                {/* Discount comparison */}
                {hasDesconto && originalVal > (os.total_cost || 0) && (
                  <div className="mb-4 rounded-xl bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-4 text-center">
                    <p className="text-xs font-bold uppercase tracking-wider text-green-700 dark:text-green-400 mb-2">Desconto Aplicado</p>
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-lg text-gray-400 line-through">{fmt(originalVal)}</span>
                      <span className="text-2xl font-extrabold text-green-700 dark:text-green-300">{fmt(os.total_cost || 0)}</span>
                    </div>
                    <span className="inline-block mt-2 rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white">
                      {Math.round(((originalVal - (os.total_cost || 0)) / originalVal) * 100)}% OFF
                    </span>
                  </div>
                )}

                {/* Value + installments — destaque do valor */}
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-4 border border-amber-200 dark:border-amber-900/50 text-center">
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">Valor total</p>
                  <p className="text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-gray-50 mt-1">{fmt(os.total_cost || 0)}</p>
                  <p className="text-sm text-emerald-700 dark:text-emerald-400 font-semibold mt-2">ou {maxParcelas}x de {parcelaValor} sem juros</p>
                </div>

                {!approvePayment ? (
                  <div className="space-y-3">
                    {/* CTA principal: APROVAR — botao gigante com icone */}
                    <button
                      type="button"
                      onClick={() => setApprovePayment('selecting')}
                      disabled={actionLoading}
                      className="w-full py-4 px-6 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-base sm:text-lg rounded-xl shadow-lg shadow-green-600/40 hover:shadow-xl hover:shadow-green-600/50 transition-all flex items-center justify-center gap-2.5 cursor-pointer"
                    >
                      <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6" />
                      Aprovar e iniciar reparo agora
                    </button>

                    {/* CTA secundario: Negociar — abre modal proprio */}
                    <button
                      type="button"
                      onClick={() => { setNegotiateReason(''); setShowNegotiate(true) }}
                      disabled={actionLoading}
                      className="w-full py-2.5 px-4 bg-transparent border-2 border-amber-400 dark:border-amber-700 hover:bg-amber-100/50 dark:hover:bg-amber-900/30 disabled:opacity-50 text-amber-800 dark:text-amber-300 font-semibold text-sm rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <MessageSquare className="h-4 w-4" />
                      Quero negociar este orcamento
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Como voce prefere pagar?</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {paymentOptions.map(pm => (
                        <button
                          key={pm.value}
                          type="button"
                          onClick={() => setApprovePayment(pm.value)}
                          className={`text-left rounded-xl border-2 p-3 transition-all cursor-pointer ${approvePayment === pm.value ? 'border-green-500 bg-green-50 dark:bg-green-950 shadow-md' : 'border-gray-200 dark:border-zinc-700 hover:border-green-300 dark:hover:border-green-700 bg-white dark:bg-gray-800'}`}
                        >
                          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{pm.icon} {pm.label}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 block">{pm.desc}</span>
                        </button>
                      ))}
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 rounded-xl p-3">
                      <p className="text-xs text-blue-700 dark:text-blue-400">📅 Previsao de entrega: ate <strong>10 dias uteis</strong>. Sempre tentamos entregar o quanto antes!</p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (approvePayment === 'selecting') { toast.error('Selecione a forma de pagamento'); return }
                          handleAction('approve', `Aprovado pelo cliente — Pagamento: ${approvePayment}`)
                        }}
                        disabled={actionLoading || approvePayment === 'selecting'}
                        className="flex-1 py-3.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-base rounded-xl shadow-md shadow-green-600/30 hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {actionLoading ? 'Processando...' : <><CheckCircle2 className="h-5 w-5" /> Confirmar aprovacao</>}
                      </button>
                      <button type="button" onClick={() => setApprovePayment(null)}
                        className="px-4 py-3.5 border-2 border-gray-300 dark:border-zinc-700 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800 font-semibold cursor-pointer">
                        Voltar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Pagar esta OS agora — so visivel apos cliente aprovar o reparo.
            Antes da aprovacao mostra mensagem explicativa pra evitar PIX
            antecipado por curiosidade (gera confusao quando orcamento muda).
            Quando aguardando aprovacao, esconde TUDO — o card de aprovacao
            (renderizado antes) ja explica formas de pagamento. */}
        {os && (os.total_cost || 0) > 0 && !isAguardandoAprovacao && os.can_pay && (
          <div className="mb-6">
            <PortalPayBox
              osId={os.id}
              totalCost={os.total_cost || 0}
              alreadyPaid={false}
            />
          </div>
        )}
        {os && (os.total_cost || 0) > 0 && !isAguardandoAprovacao && !os.can_pay && (
          <div className="mb-6 rounded-2xl border-2 border-sky-200 dark:border-sky-900 bg-gradient-to-br from-sky-50 to-white dark:from-sky-950/30 dark:to-gray-900 p-5 shadow-sm">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-sky-600 flex items-center justify-center flex-shrink-0">
                <CreditCard className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-gray-100">Como pagar esta OS</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">Voce tem duas opcoes</p>
              </div>
            </div>

            {/* Opcao destaque: Na entrega (disponivel agora) */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-3 border-2 border-emerald-300 dark:border-emerald-800 relative">
              <div className="absolute -top-2 left-3 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full">Disponivel agora</div>
              <div className="flex items-start gap-3 pt-1">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                  <Truck className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-gray-900 dark:text-gray-100 text-sm">Pague na entrega</h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 mb-3">Quando o motorista entregar seu equipamento, voce paga direto a ele:</p>
                  <ul className="text-sm text-gray-800 dark:text-gray-200 space-y-1.5">
                    <li className="flex items-center gap-2">
                      <Banknote className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                      <span>Dinheiro</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                      <span>PIX na hora</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                      <span>Cartao de credito <strong className="text-emerald-700 dark:text-emerald-400">em ate 3x</strong></span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Opcao secundaria: Antecipado (sera liberada) */}
            <div className="bg-amber-50/60 dark:bg-amber-950/20 rounded-xl p-4 border border-amber-200 dark:border-amber-900/50">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                  <Clock className="h-5 w-5 text-amber-700 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Pagar antecipado pelo portal</h4>
                  <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 leading-relaxed">Os botoes de <strong>PIX</strong> e <strong>Boleto</strong> serao liberados aqui assim que voce <strong className="text-amber-800 dark:text-amber-300">aprovar o orcamento</strong> do reparo.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Laudo e Observações */}
        {(os.diagnosis || os.reported_issue) && (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 mb-6 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Laudo Tecnico</h2>
            </div>
            <div className="p-5 space-y-4">
              {os.reported_issue && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize mb-1">Problema Relatado</h4>
                  <p className="text-gray-700 dark:text-gray-300 text-sm whitespace-pre-wrap">{os.reported_issue}</p>
                </div>
              )}
              {os.diagnosis && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize mb-1">Diagnostico / Laudo</h4>
                  <p className="text-gray-800 dark:text-gray-200 text-sm font-medium whitespace-pre-wrap">{os.diagnosis}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Condicoes do Reparo — visivel quando aguardando aprovacao ou aprovado */}
        {showCondicoesReparo && (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 mb-6 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800 bg-gradient-to-r from-blue-50 to-emerald-50 dark:from-blue-950 dark:to-emerald-950">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-lg">Condicoes do Reparo</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Informacoes importantes sobre o servico</p>
            </div>
            <div className="p-5 space-y-5">

              {/* Prazo */}
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center text-lg">🛠️</div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Prazo de Execucao</h4>
                  <ul className="mt-1 text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li>O prazo de execucao e de ate <strong>{company?.default_business_days || '10'} dias uteis</strong> a partir da aprovacao</li>
                    <li>Nosso compromisso e finalizar o quanto antes</li>
                    <li>Voce sera notificado assim que o equipamento estiver pronto</li>
                  </ul>
                </div>
              </div>

              {/* Pagamento */}
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-emerald-100 dark:bg-emerald-900 rounded-lg flex items-center justify-center text-lg">💳</div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Formas de Pagamento (na Entrega)</h4>
                  <ul className="mt-1 text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li><strong>Cartao de Credito:</strong> ate 3x sem juros</li>
                    <li><strong>Cartao de Debito:</strong> a vista</li>
                    <li><strong>PIX / Transferencia:</strong> Chave (CNPJ): <span className="font-mono text-gray-800 dark:text-gray-200">{company?.pix_chave || company?.cnpj || '—'}</span></li>
                    {company?.pix_banco && <li>Banco: {company.pix_banco}</li>}
                    <li>Favorecido: {company?.name}</li>
                    <li><strong>Dinheiro:</strong> a vista na entrega</li>
                  </ul>
                </div>
              </div>

              {/* Garantia */}
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center text-lg">🛡️</div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Garantia</h4>
                  <ul className="mt-1 text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li>Todo servico possui garantia conforme descrito no orcamento</li>
                    <li>Pecas substituidas com garantia do fabricante</li>
                    <li>Acompanhe pelo portal a qualquer momento</li>
                  </ul>
                </div>
              </div>

              {/* Entrega e Horarios */}
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-amber-100 dark:bg-amber-900 rounded-lg flex items-center justify-center text-lg">🚚</div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Entrega e Horarios</h4>
                  <ul className="mt-1 text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li>Antes da entrega, entraremos em contato para confirmar</li>
                    <li><strong>Horarios:</strong> {company?.horario || 'Seg a Qui 08:00-18:00 | Sex 08:00-17:00'}</li>
                    {company?.address && <li><strong>Endereco:</strong> {company.address}</li>}
                  </ul>
                </div>
              </div>

              {/* Contato */}
              {(company?.phone || company?.whatsapp) && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-10 h-10 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center text-lg">📞</div>
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Duvidas?</h4>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-400 space-y-1">
                      {company.phone && <p>Telefone: <strong>{company.phone}</strong></p>}
                      {company.whatsapp && (
                        <a href={`https://wa.me/${company.whatsapp.replace(/\D/g, '')}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 mt-1 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition-colors">
                          💬 Falar pelo WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Photo Gallery */}
        <div className="mb-6">
          <PhotoGallery
            osId={os.id}
            customerId={customer?.id || ''}
          />
        </div>

        {/* Items table */}
        {os.items.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 mb-6 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Itens do Orcamento</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize">Tipo</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize">Descricao</th>
                    <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize">Qtd</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize">Unit.</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {os.items.map(item => (
                    <tr key={item.id}>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          item.item_type === 'PECA'
                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                            : 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                        }`}>
                          {item.item_type === 'PECA' ? 'Peca' : 'Servico'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-900 dark:text-gray-100">{item.description}</td>
                      <td className="px-5 py-3 text-center text-gray-600 dark:text-gray-400">{item.quantity}</td>
                      <td className="px-5 py-3 text-right text-gray-600 dark:text-gray-400">
                        R$ {(item.unit_price / 100).toFixed(2)}
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-gray-900 dark:text-gray-100">
                        R$ {(item.total_price / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {(os.discount_amount ?? 0) > 0 && (
                    <>
                      <tr className="border-t border-gray-200 dark:border-zinc-700">
                        <td colSpan={4} className="px-5 py-2 text-right text-sm text-gray-500 dark:text-gray-400">
                          Subtotal
                        </td>
                        <td className="px-5 py-2 text-right text-sm text-gray-500 dark:text-gray-400">
                          R$ {(((os.total_services || 0) + (os.total_parts || 0)) / 100).toFixed(2)}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={4} className="px-5 py-2 text-right text-sm font-semibold text-green-600 dark:text-green-400">
                          Desconto
                        </td>
                        <td className="px-5 py-2 text-right text-sm font-semibold text-green-600 dark:text-green-400">
                          - R$ {((os.discount_amount || 0) / 100).toFixed(2)}
                        </td>
                      </tr>
                    </>
                  )}
                  <tr className="border-t-2 border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/50">
                    <td colSpan={4} className="px-5 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">
                      Total
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-gray-900 dark:text-gray-100 text-lg">
                      R$ {((os.total_cost || 0) / 100).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Payment status — mostra badge PAGA quando OS foi recebida/entregue com valor */}
        {isProntaOuEntregue && os.total_cost && os.total_cost > 0 && isEntregue && (
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-xl mb-6 p-6" data-print-hide>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-green-100 dark:bg-green-900 rounded-2xl flex items-center justify-center">
                <svg className="w-7 h-7 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-green-800 dark:text-green-300">OS Paga</h3>
                <p className="text-sm text-green-700 dark:text-green-400">
                  Valor total: <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(os.total_cost / 100)}</strong>
                  {(os as any).payment_method && <span className="ml-2">— {(os as any).payment_method}</span>}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* NPS Survey - OCULTO TEMPORARIAMENTE */}
        {showNps && isEntregue && npsExisting && (
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-xl p-6 mb-6" data-print-hide>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-green-900 dark:text-green-300">Obrigado pela sua avaliacao!</h3>
                <p className="text-green-700 dark:text-green-400 text-sm">Voce deu nota <strong>{npsExisting.score}</strong> para esta OS.</p>
              </div>
            </div>
            {npsExisting.comment && (
              <p className="text-green-700 dark:text-green-400 text-sm mt-2 ml-13 italic">&quot;{npsExisting.comment}&quot;</p>
            )}
          </div>
        )}

        {/* NPS Survey - Submitted just now - OCULTO TEMPORARIAMENTE */}
        {showNps && isEntregue && npsSubmitted && !npsExisting && (
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-xl p-6 mb-6 text-center" data-print-hide>
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-semibold text-green-900 dark:text-green-300 text-lg">Obrigado!</h3>
            <p className="text-green-700 dark:text-green-400 mt-1">Sua avaliacao foi registrada com sucesso.</p>
          </div>
        )}

        {/* NPS Survey Widget - OCULTO TEMPORARIAMENTE */}
        {showNpsSurvey && (
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 rounded-xl p-6 mb-6" data-print-hide>
            <h3 className="font-semibold text-blue-900 dark:text-blue-300 text-lg mb-2">Como foi sua experiencia?</h3>
            <p className="text-blue-700 dark:text-blue-400 text-sm mb-4">
              Avalie de 0 a 10: qual a probabilidade de voce recomendar nossos servicos?
            </p>

            {/* Score buttons */}
            <div className="flex flex-wrap gap-2 mb-4">
              {Array.from({ length: 11 }, (_, i) => {
                let btnColor = 'bg-red-100 text-red-700 hover:bg-red-200 border-red-200'
                if (i >= 7 && i <= 8) btnColor = 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 border-yellow-200'
                if (i >= 9) btnColor = 'bg-green-100 text-green-700 hover:bg-green-200 border-green-200'

                let selectedColor = 'bg-red-600 text-white border-red-600'
                if (i >= 7 && i <= 8) selectedColor = 'bg-yellow-500 text-white border-yellow-500'
                if (i >= 9) selectedColor = 'bg-green-600 text-white border-green-600'

                const isSelected = npsScore === i

                return (
                  <button
                    key={i}
                    onClick={() => setNpsScore(i)}
                    className={`w-11 h-11 rounded-lg border-2 font-bold text-sm transition-all ${
                      isSelected ? selectedColor : btnColor
                    }`}
                  >
                    {i}
                  </button>
                )
              })}
            </div>

            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-4 px-1">
              <span>Nada provavel</span>
              <span>Muito provavel</span>
            </div>

            {/* Comment */}
            {npsScore !== null && (
              <div className="mb-4">
                <textarea
                  value={npsComment}
                  onChange={e => setNpsComment(e.target.value)}
                  placeholder="Deixe um comentario (opcional)..."
                  rows={2}
                  className="w-full px-4 py-3 border border-blue-200 dark:border-blue-900 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none bg-white dark:bg-zinc-900"
                />
              </div>
            )}

            {/* Submit */}
            {npsScore !== null && (
              <button
                onClick={handleNpsSubmit}
                disabled={npsLoading}
                className="w-full py-3 px-6 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-colors"
              >
                {npsLoading ? 'Enviando...' : 'Enviar Avaliacao'}
              </button>
            )}
          </div>
        )}

        {/* History */}
        {os.history.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 mb-6">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Historico</h2>
            </div>
            <div className="p-5">
              <div className="space-y-4">
                {os.history.map((h, i) => (
                  <div key={h.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0 mt-1.5"
                        style={{ backgroundColor: h.to_status.color }}
                      />
                      {i < os.history.length - 1 && (
                        <div className="w-0.5 flex-1 bg-gray-200 dark:bg-zinc-700 mt-1" />
                      )}
                    </div>
                    <div className="pb-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          style={{
                            backgroundColor: `${h.to_status.color}20`,
                            color: h.to_status.color,
                          }}
                        >
                          {h.to_status.name}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(h.created_at).toLocaleDateString('pt-BR', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                      </div>
                      {h.notes && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{h.notes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Comment */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-6" data-print-hide>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Enviar Comentario</h2>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Digite sua mensagem..."
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none dark:bg-zinc-800/50"
          />
          <div className="flex justify-end mt-3">
            <button
              onClick={() => handleAction('comment', comment)}
              disabled={actionLoading || !comment.trim()}
              className="py-2.5 px-6 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-zinc-700 text-white font-medium rounded-xl transition-colors"
            >
              {actionLoading ? 'Enviando...' : 'Enviar'}
            </button>
          </div>
        </div>
      </main>

      {/* UX-9 #11: footer minimalista local removido — layout (portal) ja
          monta <PortalFooter/> enriquecido com CNPJ + endereco + selo SSL. */}
    </div>
  )
}
