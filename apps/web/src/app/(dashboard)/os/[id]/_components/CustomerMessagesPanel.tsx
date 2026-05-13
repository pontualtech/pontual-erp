'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, ChevronRight, User, Wrench } from 'lucide-react'

interface Msg {
  id: string
  message: string
  sender_type: string
  sender_name: string | null
  created_at: string
}

interface TicketSummary {
  id: string
  ticket_number: number
  subject: string
  status: string
  priority: string
  updated_at: string
}

interface Response {
  ticket: TicketSummary | null
  messages: Msg[]
}

const statusColor: Record<string, string> = {
  ABERTO: 'bg-blue-100 text-blue-700',
  EM_ANDAMENTO: 'bg-amber-100 text-amber-700',
  RESOLVIDO: 'bg-green-100 text-green-700',
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Painel lateral na pagina de detalhe da OS mostrando as ultimas 10
 * mensagens da conversa cliente↔atendente vinculada a essa OS.
 *
 * Atendente le aqui sem precisar abrir Chatwoot/Tickets. Click no card
 * leva pro ticket completo onde pode responder.
 *
 * Se OS nao tem ticket aberto, mostra estado vazio "Nenhuma conversa".
 */
export function CustomerMessagesPanel({ osId }: { osId: string }) {
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/os/${osId}/customer-messages`)
      .then(r => r.ok ? r.json() : null)
      .then(json => setData(json?.data ?? { ticket: null, messages: [] }))
      .catch(() => setData({ ticket: null, messages: [] }))
      .finally(() => setLoading(false))
  }, [osId])

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-emerald-100">
          <MessageSquare className="h-4 w-4 text-emerald-600" />
        </div>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex-1">
          Mensagens do Cliente
        </h2>
        {data?.ticket && (
          <Link
            href={`/tickets/${data.ticket.id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
          >
            Abrir conversa
            <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 text-center py-4">Carregando...</p>
      ) : !data?.ticket ? (
        <p className="text-xs text-gray-400 text-center py-4">
          Nenhuma conversa aberta com o cliente sobre essa OS.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3 text-xs text-gray-500">
            <span>Ticket #{data.ticket.ticket_number}</span>
            <span className={`rounded-full px-2 py-0.5 font-medium ${statusColor[data.ticket.status] || 'bg-gray-100 text-gray-600'}`}>
              {data.ticket.status}
            </span>
            <span>{data.messages.length} mensagem{data.messages.length === 1 ? '' : 's'}</span>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {data.messages.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">Sem mensagens ainda</p>
            ) : data.messages.map(m => {
              const isCustomer = m.sender_type === 'CLIENTE'
              return (
                <div key={m.id} className={`flex gap-2 text-sm ${isCustomer ? '' : 'flex-row-reverse'}`}>
                  <div className={`flex items-center justify-center h-6 w-6 rounded-full shrink-0 ${
                    isCustomer ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {isCustomer ? <User className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                  </div>
                  <div className={`flex-1 min-w-0 rounded-lg px-3 py-2 ${
                    isCustomer
                      ? 'bg-blue-50 text-gray-800'
                      : 'bg-gray-50 text-gray-700'
                  }`}>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400 mb-0.5">
                      <span className="font-medium">{m.sender_name || (isCustomer ? 'Cliente' : 'Atendente')}</span>
                      <span>{fmtTime(m.created_at)}</span>
                    </div>
                    <p className="text-xs whitespace-pre-wrap line-clamp-3">{m.message}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
