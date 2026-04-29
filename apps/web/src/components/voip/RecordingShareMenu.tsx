'use client'

import { useState } from 'react'
import { Share2, Loader2, Copy, Mail, MessageCircle, Download, Check } from 'lucide-react'

interface ShareMenuProps {
  callId: string
  customerName?: string | null
  startedAt?: string | null
}

/**
 * Botao Compartilhar gravacao com opcoes:
 * - Copiar link
 * - WhatsApp (wa.me com texto pronto)
 * - E-mail (mailto: com assunto + corpo)
 * - Baixar MP3 (download direto)
 *
 * O link e' um token assinado com TTL 7 dias (HMAC) — acessivel sem login.
 * Token gerado lazy quando user clica Compartilhar.
 */
export function RecordingShareMenu({ callId, customerName, startedAt }: ShareMenuProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function ensureLink(): Promise<string | null> {
    if (shareUrl) return shareUrl
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/voip/calls/${callId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl_days: 7 }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = json?.error?.message || json?.error || `HTTP ${res.status}`
        setError(typeof msg === 'string' ? msg : 'Falha ao gerar link')
        return null
      }
      const url = json?.data?.url || json?.url
      const exp = json?.data?.expiresAt || json?.expiresAt
      setShareUrl(url || null)
      setExpiresAt(exp || null)
      return url || null
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro de rede')
      return null
    } finally {
      setLoading(false)
    }
  }

  async function handleOpen() {
    setOpen(true)
    if (!shareUrl) await ensureLink()
  }

  async function handleCopy() {
    const url = await ensureLink()
    if (!url) return
    await navigator.clipboard.writeText(url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function buildMessage(url: string): string {
    const who = customerName ? ` da chamada com ${customerName}` : ''
    const when = startedAt ? ` em ${new Date(startedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''
    return `Gravacao${who}${when}: ${url}\n\nLink valido por 7 dias.`
  }

  async function handleWhatsapp() {
    const url = await ensureLink()
    if (!url) return
    const text = encodeURIComponent(buildMessage(url))
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer')
  }

  async function handleEmail() {
    const url = await ensureLink()
    if (!url) return
    const subject = encodeURIComponent(`Gravacao de chamada${customerName ? ' — ' + customerName : ''}`)
    const body = encodeURIComponent(buildMessage(url))
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  async function handleDownload() {
    const url = await ensureLink()
    if (!url) return
    // Forca download via attribute (browser pode ainda abrir player conforme Content-Disposition)
    const a = document.createElement('a')
    a.href = url
    a.download = `chamada-${callId}.mp3`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50"
        disabled={loading}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4 text-blue-600" />}
        Compartilhar
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border bg-white shadow-lg p-2 space-y-1">
            {error && <div className="text-xs text-red-600 px-2 py-1">{error}</div>}
            <button type="button" onClick={handleCopy} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-gray-50">
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-gray-600" />}
              {copied ? 'Copiado!' : 'Copiar link'}
            </button>
            <button type="button" onClick={handleWhatsapp} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-gray-50">
              <MessageCircle className="h-4 w-4 text-green-600" />
              Enviar por WhatsApp
            </button>
            <button type="button" onClick={handleEmail} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-gray-50">
              <Mail className="h-4 w-4 text-blue-600" />
              Enviar por e-mail
            </button>
            <button type="button" onClick={handleDownload} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-gray-50">
              <Download className="h-4 w-4 text-purple-600" />
              Baixar MP3
            </button>
            {expiresAt && (
              <p className="text-[10px] text-gray-400 px-3 pt-1 border-t">
                Link expira em {new Date(expiresAt).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
