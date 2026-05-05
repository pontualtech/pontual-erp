'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CreditCard, Zap, FileText, Loader2, X, Copy, Check, ExternalLink, Clock, RefreshCw } from 'lucide-react'

type PixPayment = {
  id: string
  receivable_id: string
  qr_code: string | null
  qr_code_image: string | null
  amount: number
  status: string
  expires_at: string | null
}

type BoletoPayment = {
  id: string
  receivable_id: string
  invoice_url: string | null
  bank_slip_url: string | null
  amount: number
  status: string
  due_date: string | null
}

function fmtBRL(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

/**
 * Bloco "Pagar esta OS" na tela do portal do cliente.
 * Mostra 2 opcoes (PIX / Boleto). Cliente clica, backend gera cobranca
 * Asaas, UI mostra QR code + polling. Webhook Asaas confirma → UI avisa.
 */
export default function PortalPayBox({ osId, totalCost, alreadyPaid }: {
  osId: string
  totalCost: number
  alreadyPaid: boolean
}) {
  const [loading, setLoading] = useState<'pix' | 'boleto' | null>(null)
  const [pix, setPix] = useState<PixPayment | null>(null)
  const [boleto, setBoleto] = useState<BoletoPayment | null>(null)
  const [paid, setPaid] = useState(false)
  const [copied, setCopied] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [mountChecked, setMountChecked] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // No mount: checa se OS ja foi quitada (AR RECEBIDO). Se sim, bloqueia
  // geracao de nova cobranca pra evitar duplicata (bug OS 60222).
  useEffect(() => {
    let cancelled = false
    fetch(`/api/portal/os/${osId}/pay-status`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (cancelled) return
        if (j?.data?.is_paid) setPaid(true)
        setMountChecked(true)
      })
      .catch(() => { if (!cancelled) setMountChecked(true) })
    return () => { cancelled = true }
  }, [osId])

  // UX-2 #1: auto-trigger PIX quando URL contem #pagar (vindo do financeiro)
  useEffect(() => {
    if (!mountChecked || paid || pix || boleto) return
    if (typeof window === 'undefined') return
    if (window.location.hash !== '#pagar') return
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Delay leve pra scroll terminar antes do modal abrir
    const t = setTimeout(() => { void createPix() }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountChecked, paid])

  async function createPix() {
    setLoading('pix')
    try {
      const res = await fetch('/api/portal/payments/pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_order_id: osId }),
      })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error || 'Falha ao gerar PIX'); return }
      setPix(j.data)
      startPolling(j.data.id)
    } catch {
      toast.error('Erro de rede')
    } finally { setLoading(null) }
  }

  async function createBoleto() {
    setLoading('boleto')
    try {
      const res = await fetch('/api/portal/payments/boleto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_order_id: osId }),
      })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error || 'Falha ao gerar boleto'); return }
      setBoleto(j.data)
      if (j.data.invoice_url) window.open(j.data.invoice_url, '_blank')
      startPolling(j.data.id)
    } catch {
      toast.error('Erro de rede')
    } finally { setLoading(null) }
  }

  function startPolling(paymentId: string) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/portal/payments/${paymentId}/status`, { cache: 'no-store' })
        if (!res.ok) return
        const { data } = await res.json()
        if (data.is_paid) {
          setPaid(true)
          toast.success('Pagamento confirmado!')
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        } else if (data.status === 'EXPIRED' || data.status === 'CANCELLED') {
          toast.error('Pagamento expirou. Gere um novo.')
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
          setPix(null); setBoleto(null)
        }
      } catch { /* retry next tick */ }
    }, 5000)
  }

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current)
  }, [])

  function copyPix() {
    if (!pix?.qr_code) return
    navigator.clipboard.writeText(pix.qr_code).then(() => {
      setCopied(true)
      toast.success('Código PIX copiado')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function closePix() { setPix(null); if (pollRef.current) clearInterval(pollRef.current) }

  /**
   * Fallback: cliente ja pagou no banco mas webhook Asaas nao chegou —
   * botao "Ja paguei?" dispara GET direto no Asaas pra conferir status.
   */
  async function verifyPayment() {
    const paymentId = pix?.id || boleto?.id
    if (!paymentId) return
    setVerifying(true)
    try {
      const res = await fetch(`/api/portal/payments/${paymentId}/verify`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error || 'Falha ao verificar'); return }
      if (j.data?.is_paid) {
        setPaid(true)
        toast.success('Pagamento confirmado!')
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      } else {
        toast.info('Ainda nao identificamos seu pagamento. Aguarde alguns segundos e tente de novo.')
      }
    } catch {
      toast.error('Erro de rede')
    } finally { setVerifying(false) }
  }

  if (alreadyPaid || paid) {
    return (
      <div className="rounded-2xl border-2 border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800 p-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-green-200 flex items-center justify-center">
            <Check className="h-7 w-7 text-green-700" />
          </div>
          <div>
            <h3 className="font-bold text-green-900 dark:text-green-200">Pagamento confirmado!</h3>
            <p className="text-sm text-green-700 dark:text-green-300">Obrigado. Sua OS esta quitada.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div ref={containerRef} id="pagar" className="rounded-2xl border-2 border-emerald-300 dark:border-emerald-800 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-gray-900 p-5 shadow-sm scroll-mt-20">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center">
            <CreditCard className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 dark:text-gray-100">Pague esta OS agora</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400">Antecipado pelo portal, seguro via Asaas</p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-4 text-center border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Valor a pagar</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{fmtBRL(totalCost)}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={createPix} disabled={loading !== null}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-emerald-500 bg-white hover:bg-emerald-50 dark:bg-gray-800 dark:hover:bg-emerald-950/30 transition-all disabled:opacity-50">
            {loading === 'pix' ? <Loader2 className="h-6 w-6 animate-spin text-emerald-600" /> : <Zap className="h-6 w-6 text-emerald-600" />}
            <span className="font-bold text-sm text-emerald-700 dark:text-emerald-400">PIX</span>
            <span className="text-[11px] text-gray-500 text-center">Pague agora, confirmação instantânea</span>
          </button>

          <button type="button" onClick={createBoleto} disabled={loading !== null}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-amber-500 bg-white hover:bg-amber-50 dark:bg-gray-800 dark:hover:bg-amber-950/30 transition-all disabled:opacity-50">
            {loading === 'boleto' ? <Loader2 className="h-6 w-6 animate-spin text-amber-600" /> : <FileText className="h-6 w-6 text-amber-600" />}
            <span className="font-bold text-sm text-amber-700 dark:text-amber-400">Boleto</span>
            <span className="text-[11px] text-gray-500 text-center">À vista (vence hoje)</span>
          </button>
        </div>

        {boleto && !paid && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" />
                <p className="text-xs text-amber-800 dark:text-amber-300">Boleto gerado. Aguardando pagamento...</p>
              </div>
              {boleto.invoice_url && (
                <a href={boleto.invoice_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-semibold text-amber-700 hover:underline flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" /> abrir
                </a>
              )}
            </div>
            <button type="button" onClick={verifyPayment} disabled={verifying}
              className="w-full rounded-lg border-2 border-emerald-500 bg-white text-emerald-700 hover:bg-emerald-50 py-2 text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
              {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Ja paguei — verificar agora
            </button>
          </div>
        )}
      </div>

      {pix && !paid && (
        <PixModal
          pix={pix}
          copied={copied}
          verifying={verifying}
          onClose={closePix}
          onCopy={copyPix}
          onVerify={verifyPayment}
        />
      )}
    </>
  )
}

/**
 * Modal PIX cross-browser: usa div + fixed em vez de <dialog> nativo
 * pra suportar iOS Safari < 15.4. Inclui body scroll lock, ESC pra fechar
 * e tap-fora-fecha. Aspect-square no QR pra evitar layout shift.
 */
function PixModal({
  pix, copied, verifying, onClose, onCopy, onVerify,
}: {
  pix: PixPayment
  copied: boolean
  verifying: boolean
  onClose: () => void
  onCopy: () => void
  onVerify: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pix-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[420px] max-h-[95dvh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <div className="bg-emerald-600 px-5 py-3 flex items-center justify-between sticky top-0">
          <h3 id="pix-modal-title" className="text-white font-bold flex items-center gap-2">
            <Zap className="h-5 w-5" /> Pagamento PIX
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal de pagamento"
            className="text-white/80 hover:text-white p-1 -m-1 rounded touch-manipulation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 text-center">
          <p className="text-sm text-gray-600 mb-3">Escaneie o QR code com o app do seu banco</p>
          {pix.qr_code_image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={pix.qr_code_image}
              alt="QR Code PIX"
              className="w-64 h-64 mx-auto border-4 border-emerald-500 rounded-xl"
            />
          ) : (
            <div className="w-64 h-64 mx-auto flex items-center justify-center border-2 border-gray-200 rounded-xl">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          )}

          <p className="text-xs text-gray-500 mt-3 mb-1">OU copie e cole no seu banco:</p>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              readOnly
              value={pix.qr_code || ''}
              aria-label="Código PIX copia e cola"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono bg-gray-50 min-h-[44px]"
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              onClick={onCopy}
              aria-label={copied ? 'Codigo copiado' : 'Copiar codigo PIX'}
              className="px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 flex items-center gap-2 justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span className="text-sm text-blue-800">Aguardando pagamento...</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">A confirmacao chega automaticamente em segundos.</p>

          <button
            type="button"
            onClick={onVerify}
            disabled={verifying}
            className="mt-3 w-full rounded-lg border-2 border-emerald-500 bg-white text-emerald-700 hover:bg-emerald-50 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 min-h-[44px]"
          >
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Ja paguei — verificar agora
          </button>
        </div>
      </div>
    </div>
  )
}
