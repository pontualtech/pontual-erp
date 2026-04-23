'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Star, ExternalLink, MessageCircle, Link2, RefreshCw } from 'lucide-react'

type Review = {
  name: string
  reviewId: string
  reviewer: { displayName: string; profilePhotoUrl?: string }
  starRating: string
  starNumber: number
  comment: string
  createTime: string
  updateTime: string
  reviewReply?: { comment: string; updateTime: string }
}

function StarRow({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`w-3.5 h-3.5 ${i <= n ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
      ))}
    </span>
  )
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function GoogleBusinessPage() {
  const params = useSearchParams()
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [replying, setReplying] = useState<string | null>(null)
  const [replyText, setReplyText] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/integracoes/google-business/reviews', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || 'erro')
      setReviews(j.data?.reviews || [])
      if (j.data?.error) setError(j.data.error)
    } catch (err: any) {
      setError(err?.message || 'Falha ao carregar')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (params.get('connected') === '1') toast.success('Conta Google conectada!')
    if (params.get('error')) toast.error(`OAuth: ${params.get('error')}`)
    load()
  }, [params, load])

  async function submitReply(name: string) {
    const comment = (replyText[name] || '').trim()
    if (!comment) return toast.error('Escreva uma resposta')
    setReplying(name)
    try {
      const res = await fetch('/api/integracoes/google-business/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, comment }),
      })
      const j = await res.json()
      if (!res.ok) { toast.error(j?.error || 'Falha'); return }
      toast.success('Resposta enviada')
      setReplyText(p => ({ ...p, [name]: '' }))
      load()
    } finally { setReplying(null) }
  }

  const notConnected = error?.includes('no_token') || error?.includes('OAuth nao configurado')
  const avg = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.starNumber, 0) / reviews.length)
    : null

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="text-gray-500 hover:text-gray-900">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-500" /> Google Business Profile
            </h1>
            <p className="text-xs text-gray-500">Reviews do Google Meu Negocio e respostas</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Atualizar
          </button>
        </div>
      </div>

      {notConnected && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
          <h3 className="text-sm font-semibold text-yellow-900 mb-2">Conta nao conectada</h3>
          <p className="text-xs text-yellow-800 mb-3">
            Autorize o ERP a acessar seu Google Meu Negocio. Precisa fazer login com a conta admin do GBP.
          </p>
          <a href="/api/integracoes/google-business/connect"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            <Link2 className="w-4 h-4" /> Conectar com Google
          </a>
        </div>
      )}

      {reviews.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border bg-white p-4">
            <p className="text-xs text-gray-500 uppercase">Total</p>
            <p className="text-2xl font-bold text-gray-900">{reviews.length}</p>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <p className="text-xs text-gray-500 uppercase">Media</p>
            <p className="text-2xl font-bold text-yellow-600 flex items-center gap-1">
              {avg?.toFixed(1)} <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
            </p>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <p className="text-xs text-gray-500 uppercase">Sem resposta</p>
            <p className="text-2xl font-bold text-red-600">
              {reviews.filter(r => !r.reviewReply).length}
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : error && !notConnected ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : reviews.length === 0 ? (
        !notConnected && <div className="text-center py-12 text-sm text-gray-500">Nenhuma avaliacao ainda.</div>
      ) : (
        <div className="space-y-3">
          {reviews.map(r => (
            <div key={r.reviewId} className="rounded-xl border bg-white p-4">
              <div className="flex items-start gap-3">
                {r.reviewer.profilePhotoUrl
                  ? <img src={r.reviewer.profilePhotoUrl} alt="" className="w-10 h-10 rounded-full" />
                  : <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-bold">
                      {r.reviewer.displayName[0] || '?'}
                    </div>
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-gray-900 text-sm">{r.reviewer.displayName}</p>
                    <p className="text-[11px] text-gray-400">{fmtDate(r.createTime)}</p>
                  </div>
                  <StarRow n={r.starNumber} />
                  {r.comment && <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{r.comment}</p>}
                </div>
              </div>

              {r.reviewReply ? (
                <div className="mt-3 ml-12 p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
                  <p className="text-[11px] font-semibold text-indigo-700 uppercase mb-1">Sua resposta</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.reviewReply.comment}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{fmtDate(r.reviewReply.updateTime)}</p>
                </div>
              ) : (
                <div className="mt-3 ml-12 space-y-2">
                  <textarea
                    value={replyText[r.name] || ''}
                    onChange={e => setReplyText(p => ({ ...p, [r.name]: e.target.value }))}
                    placeholder="Responder esta avaliacao..."
                    rows={2}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <div className="flex justify-end">
                    <button onClick={() => submitReply(r.name)} disabled={replying === r.name || !(replyText[r.name] || '').trim()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                      {replying === r.name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                      Responder
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
