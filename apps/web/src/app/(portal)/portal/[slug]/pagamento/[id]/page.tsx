'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

interface PaymentInfo {
  id: string
  qr_code: string | null
  qr_code_image: string | null
  amount: number
  status: string
  expires_at: string | null
  paid_at?: string | null
}

export default function PortalPagamentoPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string
  const osId = params.id as string

  const [loading, setLoading] = useState(true)
  const [payment, setPayment] = useState<PaymentInfo | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)

  // Create or fetch PIX charge
  const createCharge = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/portal/payments/pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_order_id: osId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Erro ao gerar pagamento')
        return
      }
      setPayment(data.data)
    } catch {
      setError('Erro de conexao')
    } finally {
      setLoading(false)
    }
  }, [osId])

  useEffect(() => { createCharge() }, [createCharge])

  // Poll status every 5s while PENDING
  useEffect(() => {
    if (!payment || payment.status !== 'PENDING') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/portal/payments/${payment.id}/status`)
        if (res.ok) {
          const data = await res.json()
          if (data.data.status !== 'PENDING') {
            setPayment(prev => prev ? { ...prev, ...data.data } : prev)
            if (data.data.status === 'CONFIRMED') {
              toast.success('Pagamento confirmado!')
            }
          }
        }
      } catch {}
    }, 5000)
    return () => clearInterval(interval)
  }, [payment])

  // Timer countdown
  useEffect(() => {
    if (!payment?.expires_at || payment.status !== 'PENDING') return
    const update = () => {
      const diff = Math.max(0, Math.floor((new Date(payment.expires_at!).getTime() - Date.now()) / 1000))
      setTimeLeft(diff)
      if (diff <= 0) {
        setPayment(prev => prev ? { ...prev, status: 'EXPIRED' } : prev)
      }
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [payment?.expires_at, payment?.status])

  async function handleCopy() {
    if (!payment?.qr_code) return
    try {
      await navigator.clipboard.writeText(payment.qr_code)
      setCopied(true)
      toast.success('Codigo PIX copiado!')
      setTimeout(() => setCopied(false), 3000)
    } catch {
      toast.error('Erro ao copiar')
    }
  }

  const timerMinutes = Math.floor(timeLeft / 60)
  const timerSeconds = timeLeft % 60

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href={`/portal/${slug}/os/${osId}`} className="text-sm text-blue-600 dark:text-blue-400 font-medium inline-flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Voltar para OS
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Pagamento via PIX</h1>

        {loading && (
          <div className="flex flex-col items-center py-12 gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-200 dark:border-blue-900 border-t-blue-600 dark:border-t-blue-400" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Gerando QR Code PIX...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl p-5 text-center">
            <svg className="w-10 h-10 text-red-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-red-700 dark:text-red-400 font-medium">{error}</p>
            <button type="button" onClick={createCharge} className="mt-3 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">
              Tentar novamente
            </button>
          </div>
        )}

        {/* CONFIRMED */}
        {payment?.status === 'CONFIRMED' && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-700 p-8 text-center">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-green-700 dark:text-green-400 mb-2">Pagamento Confirmado!</h2>
            <p className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-1">{fmtCents(payment.amount)}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Pago em {payment.paid_at ? new Date(payment.paid_at).toLocaleString('pt-BR') : '-'}
            </p>
            <Link
              href={`/portal/${slug}/os/${osId}`}
              className="inline-block bg-blue-600 dark:bg-blue-500 text-white font-semibold py-3 px-8 rounded-xl hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
            >
              Voltar para OS
            </Link>
          </div>
        )}

        {/* EXPIRED */}
        {payment?.status === 'EXPIRED' && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-700 p-8 text-center">
            <div className="w-20 h-20 bg-amber-100 dark:bg-amber-900 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-amber-700 dark:text-amber-400 mb-2">QR Code Expirado</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-4">O tempo para pagamento expirou.</p>
            <button
              type="button"
              onClick={createCharge}
              className="bg-blue-600 dark:bg-blue-500 text-white font-semibold py-3 px-8 rounded-xl hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
            >
              Gerar Novo QR Code
            </button>
          </div>
        )}

        {/* PENDING — QR Code */}
        {payment?.status === 'PENDING' && !loading && (
          <div className="space-y-5">
            {/* Value card */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-700 p-6 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Valor a pagar</p>
              <p className="text-4xl font-bold text-gray-900 dark:text-gray-100">{fmtCents(payment.amount)}</p>
            </div>

            {/* QR Code */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-700 p-6 flex flex-col items-center">
              {payment.qr_code_image ? (
                <img src={payment.qr_code_image} alt="QR Code PIX" className="w-64 h-64 mb-4 rounded-lg" />
              ) : (
                <div className="w-64 h-64 bg-gray-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center mb-4">
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center px-4">
                    QR Code visual indisponivel.<br/>Use o codigo copia-e-cola abaixo.
                  </p>
                </div>
              )}

              {/* Timer */}
              <div className="mb-4">
                {timeLeft > 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Expira em{' '}
                    <span className={`font-mono font-bold ${timeLeft <= 300 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                      {timerMinutes}:{String(timerSeconds).padStart(2, '0')}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-red-600 dark:text-red-400 font-medium">Expirado</p>
                )}
              </div>

              {/* Copia e cola */}
              {payment.qr_code && (
                <div className="w-full">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 text-center">PIX Copia e Cola</p>
                  <div className="bg-gray-50 dark:bg-zinc-800 rounded-lg p-3 break-all text-xs text-gray-600 dark:text-gray-400 font-mono max-h-20 overflow-auto mb-3">
                    {payment.qr_code}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className={`w-full py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 ${
                      copied
                        ? 'bg-green-600 text-white'
                        : 'bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white'
                    }`}
                  >
                    {copied ? (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Copiado!
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                        Copiar Codigo PIX
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Instructions */}
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 rounded-xl p-4">
              <h3 className="font-semibold text-blue-800 dark:text-blue-300 text-sm mb-2">Como pagar:</h3>
              <ol className="text-sm text-blue-700 dark:text-blue-400 space-y-1 list-decimal list-inside">
                <li>Abra o app do seu banco</li>
                <li>Escolha pagar com PIX</li>
                <li>Escaneie o QR Code ou cole o codigo</li>
                <li>Confirme o pagamento</li>
              </ol>
              <p className="text-xs text-blue-600 dark:text-blue-500 mt-2">A confirmacao e automatica e leva poucos segundos.</p>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 mt-12">
        <div className="max-w-2xl mx-auto px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
          Powered by PontualERP
        </div>
      </footer>
    </div>
  )
}
