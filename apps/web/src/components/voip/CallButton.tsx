'use client'

import { useState } from 'react'
import { Phone } from 'lucide-react'

export interface CallButtonProps {
  /** Telefone do destinatário. Aceita formatos brasileiros (11) 9 8888-7777, 11988887777, +5511988887777 etc. */
  phoneNumber: string | null | undefined
  /** ID do cliente, encaminhado pra audit/CDR (opcional) */
  customerId?: string
  /** ID da OS, encaminhado pra audit/CDR (opcional) */
  serviceOrderId?: string
  /** Estilo do botão. default = pill verde com texto. icon = só ícone telefone. compact = pill pequeno. */
  variant?: 'default' | 'icon' | 'compact'
  /** Classes Tailwind adicionais */
  className?: string
  /** Texto custom no botão (sobrescreve default "Ligar") */
  label?: string
}

/**
 * Botão "Ligar" que dispara Click2Call via API ERP.
 *
 * Fluxo UX:
 *   1. Agente clica no botão
 *   2. POST /api/voip/click-to-call com phoneNumber
 *   3. Sonax disca PRIMEIRO o ramal do agente (Linphone toca)
 *   4. Quando agente atende, Sonax disca o cliente
 *   5. Áudio bidirecional entre os dois
 *
 * Pré-requisito: agente precisa ter Linphone aberto + ramal cadastrado em SONAX_RAMAL_MAPPING.
 *
 * Renderiza nada (null) se phoneNumber inválido ou ausente.
 */
export function CallButton({
  phoneNumber,
  customerId,
  serviceOrderId,
  variant = 'default',
  className = '',
  label,
}: CallButtonProps) {
  const [loading, setLoading] = useState(false)

  // Esconde o botão se não tem número válido
  if (!phoneNumber) return null
  const digitsOnly = phoneNumber.replace(/\D/g, '')
  if (digitsOnly.length < 8) return null

  async function handleCall() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/voip/click-to-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, customerId, serviceOrderId }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const msg = data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`
        alert('Erro ao iniciar chamada: ' + msg)
        return
      }

      const ramal = data?.data?.ramal || data?.ramal || '?'
      alert(
        `🔔 O Linphone do ramal ${ramal} vai tocar agora.\n\nAtenda para falar com o cliente — o sistema disca o número automaticamente quando você atender.`
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'erro de rede desconhecido'
      alert('Erro de rede: ' + msg)
    } finally {
      setLoading(false)
    }
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleCall}
        disabled={loading}
        title={loading ? 'Discando...' : `Ligar para ${phoneNumber}`}
        aria-label={`Ligar para ${phoneNumber}`}
        className={`inline-flex items-center justify-center p-1.5 rounded hover:bg-green-50 text-green-600 disabled:opacity-50 disabled:cursor-wait ${className}`}
      >
        <Phone className="w-4 h-4" />
      </button>
    )
  }

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleCall}
        disabled={loading}
        title={`Ligar para ${phoneNumber}`}
        className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-wait ${className}`}
      >
        <Phone className="w-3 h-3" />
        {loading ? '...' : (label || 'Ligar')}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleCall}
      disabled={loading}
      title={`Ligar para ${phoneNumber}`}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-wait ${className}`}
    >
      <Phone className="w-4 h-4" />
      {loading ? 'Discando...' : (label || 'Ligar')}
    </button>
  )
}
