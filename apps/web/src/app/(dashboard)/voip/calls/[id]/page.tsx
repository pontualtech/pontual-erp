'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, PhoneIncoming, PhoneOutgoing, PhoneMissed, User, Clock, Phone, FileAudio, Wrench, Link2 } from 'lucide-react'
import { RecordingPlayer } from '@/components/voip/RecordingPlayer'
import { LinkOsToCall } from '@/components/voip/LinkOsToCall'
import { RecordingShareMenu } from '@/components/voip/RecordingShareMenu'

interface Call {
  id: string
  call_id: string
  direction: string
  from_number: string
  to_number: string
  did_number: string | null
  status: string
  hangup_cause: string | null
  started_at: string
  answered_at: string | null
  ended_at: string | null
  duration_sec: number | null
  recording_url: string | null
  recording_path: string | null
  agent_extension: string | null
  notes: string | null
  customers?: { id: string; legal_name: string; trade_name: string | null; mobile: string | null; phone: string | null; document_number: string | null } | null
  user_profiles?: { id: string; name: string; email: string } | null
  service_order_id?: string | null
  service_orders?: { id: string; os_number: number; equipment_type: string; equipment_brand: string | null; equipment_model: string | null } | null
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
}

function formatDuration(s: number | null) {
  if (s == null) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}min ${sec}s`
  return `${m}min ${sec}s`
}

export default function VoipCallDetailPage() {
  const params = useParams()
  const id = params.id as string
  const [call, setCall] = useState<Call | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/voip/calls/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(typeof d.error === 'string' ? d.error : (d.error?.message || 'Erro')); return }
        setCall(d.data ?? d)
      })
      .catch(() => setError('Erro ao carregar chamada'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="py-12 text-center text-gray-400">Carregando...</div>
  if (error || !call) return (
    <div className="py-12 text-center">
      <p className="text-red-500">{error || 'Chamada não encontrada'}</p>
      <Link href="/voip/calls" className="text-sm text-blue-600 hover:underline mt-3 inline-block">Voltar</Link>
    </div>
  )

  const Icon = call.status === 'missed' || call.status === 'no_answer'
    ? PhoneMissed
    : (call.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing)

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/voip/calls" className="rounded-md border p-2 hover:bg-gray-50">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Icon className={`h-6 w-6 ${call.direction === 'inbound' ? 'text-green-600' : 'text-blue-600'}`} />
          Chamada {call.direction === 'inbound' ? 'Recebida' : 'Realizada'}
        </h1>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Phone className="h-4 w-4 text-blue-600" /> Detalhes da chamada
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Direção</span><span className="text-gray-900">{call.direction === 'inbound' ? 'Recebida' : 'Realizada'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">De</span><span className="font-mono text-gray-900">{call.from_number || '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Para</span><span className="font-mono text-gray-900">{call.to_number || '—'}</span></div>
            {call.did_number && (
              <div className="flex justify-between"><span className="text-gray-500">DID</span><span className="font-mono text-gray-900">{call.did_number}</span></div>
            )}
            <div className="flex justify-between"><span className="text-gray-500">Status</span><span className="text-gray-900">{call.status}</span></div>
            {call.hangup_cause && (
              <div className="flex justify-between"><span className="text-gray-500">Causa</span><span className="text-gray-900 text-xs">{call.hangup_cause}</span></div>
            )}
          </div>
        </div>

        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" /> Tempos
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Início</span><span className="text-gray-900">{formatDateTime(call.started_at)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Atendida em</span><span className="text-gray-900">{formatDateTime(call.answered_at)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Encerrada</span><span className="text-gray-900">{formatDateTime(call.ended_at)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Duração</span><span className="text-gray-900 font-medium">{formatDuration(call.duration_sec)}</span></div>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <User className="h-4 w-4 text-gray-600" /> Cliente
          </h2>
          {call.customers ? (
            <div className="space-y-2 text-sm">
              <div className="text-gray-900 font-medium">
                <Link href={`/clientes/${call.customers.id}`} className="text-blue-600 hover:underline">
                  {call.customers.legal_name}
                </Link>
              </div>
              {call.customers.trade_name && <div className="text-gray-500">{call.customers.trade_name}</div>}
              {call.customers.document_number && (
                <div className="flex justify-between"><span className="text-gray-500">CPF/CNPJ</span><span className="text-gray-900">{call.customers.document_number}</span></div>
              )}
              {call.customers.mobile && (
                <div className="flex justify-between"><span className="text-gray-500">Celular</span><span className="text-gray-900 font-mono">{call.customers.mobile}</span></div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic">Cliente não identificado pelo telefone</div>
          )}
        </div>

        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <User className="h-4 w-4 text-gray-600" /> Atendente
          </h2>
          {call.user_profiles ? (
            <div className="space-y-2 text-sm">
              <div className="text-gray-900 font-medium">{call.user_profiles.name}</div>
              <div className="text-gray-500 text-xs">{call.user_profiles.email}</div>
              {call.agent_extension && (
                <div className="flex justify-between"><span className="text-gray-500">Ramal</span><span className="font-mono text-gray-900">{call.agent_extension}</span></div>
              )}
            </div>
          ) : call.agent_extension ? (
            <div className="text-sm">
              <div className="text-gray-500">Ramal {call.agent_extension}</div>
              <div className="text-xs text-gray-400 italic">Ramal não vinculado a usuário ERP</div>
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic">Sem atendente identificado</div>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-white p-5 space-y-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Wrench className="h-4 w-4 text-orange-600" /> Ordem de Serviço vinculada
        </h2>
        {call.service_orders ? (
          <div className="flex items-center justify-between gap-2">
            <Link href={`/os/${call.service_orders.id}`} className="flex-1 text-sm text-blue-600 hover:underline">
              <span className="font-mono font-semibold">#{call.service_orders.os_number}</span>
              <span className="ml-2 text-gray-700">{call.service_orders.equipment_type}</span>
              {call.service_orders.equipment_brand && (
                <span className="text-gray-500"> · {call.service_orders.equipment_brand} {call.service_orders.equipment_model || ''}</span>
              )}
            </Link>
            <LinkOsToCall
              callId={call.id}
              customerId={call.customers?.id || null}
              currentOsId={call.service_order_id || null}
              onChange={() => window.location.reload()}
              mode="change"
            />
          </div>
        ) : call.customers?.id ? (
          <LinkOsToCall
            callId={call.id}
            customerId={call.customers.id}
            currentOsId={null}
            onChange={() => window.location.reload()}
            mode="link"
          />
        ) : (
          <p className="text-sm text-gray-400 italic">
            Vincular OS exige cliente identificado nesta chamada.
          </p>
        )}
      </div>

      {call.recording_url && (
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <FileAudio className="h-4 w-4 text-purple-600" /> Gravação
            </h2>
            <RecordingShareMenu
              callId={call.id}
              customerName={call.customers?.legal_name}
              startedAt={call.started_at}
            />
          </div>
          <RecordingPlayer callId={call.id} durationSec={call.duration_sec} />
          <p className="text-xs text-gray-500">
            ⚠️ Gravação contém dados pessoais. Acesso restrito por LGPD. Links compartilhados expiram em 7 dias.
          </p>
        </div>
      )}

      {call.notes && (
        <div className="rounded-lg border bg-white p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Anotações</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{call.notes}</p>
        </div>
      )}
    </div>
  )
}
