/**
 * In-process pub/sub para eventos VoIP em tempo real (SSE).
 *
 * Singleton: armazenado em globalThis pra sobreviver a HMR no dev mode.
 * Em prod (Coolify single-instance Next.js), funciona como esperado.
 * Se um dia escalar pra múltiplos containers, trocar por Redis pub/sub.
 */

import { EventEmitter } from 'events'

declare global {
  // eslint-disable-next-line no-var
  var __voipEventBus__: EventEmitter | undefined
  // eslint-disable-next-line no-var
  var __voipWebhookHits__: WebhookHit[] | undefined
}

export interface WebhookHit {
  ts: string
  endpoint: string
  ip: string
  headers: Record<string, string>
  query: string
  body: unknown
  outcome: 'allowed' | 'forbidden_ip' | 'invalid_body' | 'no_call_id' | 'company_not_configured' | 'created' | 'updated' | 'error'
  error?: string
}

export function logWebhookHit(hit: WebhookHit): void {
  if (!globalThis.__voipWebhookHits__) globalThis.__voipWebhookHits__ = []
  globalThis.__voipWebhookHits__.unshift(hit)
  if (globalThis.__voipWebhookHits__.length > 50) {
    globalThis.__voipWebhookHits__.length = 50
  }
}

export function getRecentWebhookHits(): WebhookHit[] {
  return globalThis.__voipWebhookHits__ || []
}

function getBus(): EventEmitter {
  if (!globalThis.__voipEventBus__) {
    const e = new EventEmitter()
    e.setMaxListeners(50) // até 50 abas/usuários conectados via SSE
    globalThis.__voipEventBus__ = e
  }
  return globalThis.__voipEventBus__
}

export type VoipEvent = {
  type: 'call.start' | 'call.answered' | 'call.missed' | 'call.completed'
  companyId: string
  voipCallId: string
  callId: string
  direction: 'inbound' | 'outbound'
  fromNumber: string
  toNumber: string
  customerId: string | null
  customerName: string | null
  agentExtension: string | null
  status: string
  startedAt: string
}

export function emitVoipEvent(ev: VoipEvent): void {
  getBus().emit('voip', ev)
}

export function subscribeVoipEvents(handler: (ev: VoipEvent) => void): () => void {
  const bus = getBus()
  bus.on('voip', handler)
  return () => bus.off('voip', handler)
}
