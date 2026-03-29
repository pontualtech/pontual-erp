'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

interface PaymentData {
  id: string
  description: string
  total_amount: number
  received_amount: number
  pending_amount: number
  due_date: string
  days_overdue: number
  status: string
  payment_method: string | null
  boleto_url: string | null
  pix_code: string | null
  customer_name: string
  company: {
    name: string
    phone: string
    email: string
    pix_key: string | null
    bank_info: string | null
    whatsapp: string | null
  }
}

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function fmtDate(date: string): string {
  return new Date(date).toLocaleDateString('pt-BR')
}

export default function PortalPaymentPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slug = params.slug as string
  const id = params.id as string
  const token = searchParams.get('token')

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<PaymentData | null>(null)
  const [error, setError] = useState('')
  const [marking, setMarking] = useState(false)
  const [marked, setMarked] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('Link inválido. Token de acesso não encontrado.')
      setLoading(false)
      return
    }

    fetch(`/api/portal/pagamento/${id}?token=${token}&slug=${slug}`)
      .then(r => {
        if (!r.ok) throw new Error('Link inválido ou expirado')
        return r.json()
      })
      .then(res => {
        if (res.data) setData(res.data)
        else throw new Error('Dados não encontrados')
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id, token, slug])

  async function handleMarkPaid() {
    if (!confirm('Confirma que o pagamento foi realizado? A empresa será notificada.')) return
    setMarking(true)
    try {
      const res = await fetch(`/api/portal/pagamento/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, slug, action: 'mark_paid' }),
      })
      if (!res.ok) throw new Error('Erro ao registrar pagamento')
      setMarked(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro')
    } finally {
      setMarking(false)
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="mt-3 text-gray-500">Carregando...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md rounded-lg border bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Link inválido</h2>
          <p className="mt-2 text-sm text-gray-500">{error || 'Não foi possível carregar as informações de pagamento.'}</p>
        </div>
      </div>
    )
  }

  const isPaid = data.status === 'RECEBIDO' || marked
  const isOverdue = data.days_overdue > 0 && !isPaid

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-gray-900">{data.company.name}</h1>
          <p className="text-sm text-gray-500">Portal de Pagamento</p>
        </div>

        {/* Status */}
        {isPaid ? (
          <div className="mb-6 rounded-lg border-2 border-green-200 bg-green-50 p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-green-800">
              {marked ? 'Pagamento informado com sucesso!' : 'Já pago'}
            </h2>
            <p className="mt-1 text-sm text-green-600">
              {marked
                ? 'Obrigado! A empresa foi notificada sobre seu pagamento.'
                : 'Este título já foi quitado. Obrigado!'
              }
            </p>
          </div>
        ) : (
          <>
            {/* Payment info card */}
            <div className="mb-4 rounded-lg border bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Detalhes da Cobrança</h2>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  isOverdue
                    ? 'bg-red-100 text-red-700'
                    : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {isOverdue ? 'Vencido' : 'Pendente'}
                </span>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Cliente</span>
                  <span className="font-medium text-gray-900">{data.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Descrição</span>
                  <span className="font-medium text-gray-900">{data.description}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Vencimento</span>
                  <span className={`font-medium ${isOverdue ? 'text-red-600' : 'text-gray-900'}`}>
                    {fmtDate(data.due_date)}
                  </span>
                </div>
                {isOverdue && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Dias em atraso</span>
                    <span className="font-medium text-red-600">{data.days_overdue} dias</span>
                  </div>
                )}
                <div className="border-t pt-3">
                  <div className="flex justify-between">
                    <span className="text-lg font-semibold text-gray-900">Valor</span>
                    <span className="text-lg font-bold text-gray-900">{fmtCents(data.pending_amount)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment methods */}
            <div className="mb-4 space-y-3">
              {/* PIX */}
              {data.company.pix_key && (
                <div className="rounded-lg border bg-white p-4 shadow-sm">
                  <h3 className="mb-2 font-semibold text-gray-900">PIX</h3>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-lg bg-gray-100 px-3 py-2 font-mono text-sm text-gray-700">
                      {data.company.pix_key}
                    </div>
                    <button
                      onClick={() => copyToClipboard(data.company.pix_key!)}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      {copied ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                </div>
              )}

              {/* PIX Code (QR) */}
              {data.pix_code && (
                <div className="rounded-lg border bg-white p-4 shadow-sm">
                  <h3 className="mb-2 font-semibold text-gray-900">PIX Copia e Cola</h3>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 truncate rounded-lg bg-gray-100 px-3 py-2 font-mono text-xs text-gray-700">
                      {data.pix_code}
                    </div>
                    <button
                      onClick={() => copyToClipboard(data.pix_code!)}
                      className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              )}

              {/* Boleto */}
              {data.boleto_url && (
                <div className="rounded-lg border bg-white p-4 shadow-sm">
                  <h3 className="mb-2 font-semibold text-gray-900">Boleto</h3>
                  <a
                    href={data.boleto_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Abrir Boleto
                  </a>
                </div>
              )}

              {/* Bank transfer */}
              {data.company.bank_info && (
                <div className="rounded-lg border bg-white p-4 shadow-sm">
                  <h3 className="mb-2 font-semibold text-gray-900">Transferência Bancária</h3>
                  <pre className="whitespace-pre-wrap rounded-lg bg-gray-100 p-3 text-sm text-gray-700">
                    {data.company.bank_info}
                  </pre>
                </div>
              )}
            </div>

            {/* Mark as paid */}
            <button
              onClick={handleMarkPaid}
              disabled={marking}
              className="w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {marking ? 'Registrando...' : 'Já realizei o pagamento'}
            </button>
          </>
        )}

        {/* Contact */}
        <div className="mt-6 rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Dúvidas? Entre em contato</h3>
          <div className="space-y-1 text-sm text-gray-500">
            {data.company.phone && (
              <p>Telefone: <a href={`tel:${data.company.phone}`} className="text-blue-600 hover:underline">{data.company.phone}</a></p>
            )}
            {data.company.email && (
              <p>Email: <a href={`mailto:${data.company.email}`} className="text-blue-600 hover:underline">{data.company.email}</a></p>
            )}
            {data.company.whatsapp && (
              <p>
                <a
                  href={`https://wa.me/${data.company.whatsapp.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-600 hover:underline"
                >
                  WhatsApp
                </a>
              </p>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          {data.company.name} - Portal de Pagamento
        </p>
      </div>
    </div>
  )
}
