import { prisma } from '@pontual/db'

// Consentimento WhatsApp do cliente (Fase 1 conformidade Meta, 15/06).
// Guardado em Customer.custom_data.whatsapp_consent (sem migration de schema).
//   { marketing?: bool, opted_out?: bool, source?: string, updated_at?: string }
// - opted_out = true bloqueia TODO envio proativo (utility + marketing). O bot
//   continua respondendo o cliente (inbound). Decisão Karlão 15/06.
// - marketing = opt-in explícito p/ campanhas (usado na Fase 4).

export interface WhatsAppConsent {
  marketing?: boolean
  opted_out?: boolean
  source?: string
  updated_at?: string
  // Fase 4: opt-in de marketing (origem/quando) + ultimo envio de marketing (cap).
  marketing_source?: string
  marketing_at?: string
  last_marketing_at?: string
}

export interface MarketingDecision {
  allowed: boolean
  reason: 'ok' | 'no_optin' | 'opted_out' | 'cap'
}

/**
 * Decisao PURA de envio de marketing (Fase 4): exige opt-in, respeita opt-out e
 * o cap de frequencia (min capDays entre marketings). nowMs/capDays injetados
 * pra testabilidade. NAO consulta DB.
 */
export function marketingDecision(consent: WhatsAppConsent, nowMs: number, capDays: number): MarketingDecision {
  if (consent.opted_out === true) return { allowed: false, reason: 'opted_out' }
  if (consent.marketing !== true) return { allowed: false, reason: 'no_optin' }
  const last = consent.last_marketing_at ? Date.parse(consent.last_marketing_at) : 0
  if (last && nowMs - last < capDays * 86400000) return { allowed: false, reason: 'cap' }
  return { allowed: true, reason: 'ok' }
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Lê whatsapp_consent do custom_data (defensivo — nunca lança). */
export function readConsent(customData: unknown): WhatsAppConsent {
  const cd = asObject(customData)
  const c = cd ? asObject(cd.whatsapp_consent) : null
  return (c as WhatsAppConsent) || {}
}

/** Cliente pediu pra parar → bloqueia todo proativo. */
export function isOptedOut(customData: unknown): boolean {
  return readConsent(customData).opted_out === true
}

/** Grava (merge) o consent no custom_data do customer, sem destruir outras chaves. */
export async function setCustomerConsent(customerId: string, patch: Partial<WhatsAppConsent>): Promise<void> {
  const cust = await prisma.customer.findUnique({ where: { id: customerId }, select: { custom_data: true } })
  const cd = { ...(asObject(cust?.custom_data) || {}) }
  cd.whatsapp_consent = { ...readConsent(cd), ...patch, updated_at: new Date().toISOString() }
  await prisma.customer.update({ where: { id: customerId }, data: { custom_data: cd as any } })
}

const PHONE_OR = (end: string) => ({ OR: [{ mobile: { endsWith: end } }, { phone: { endsWith: end } }] })

function phoneEnd(phone: string | null | undefined): string | null {
  const end = (phone || '').replace(/\D/g, '').slice(-10)
  return end.length >= 10 ? end : null
}

/** Marca opt-out por telefone (últimos 10 dígitos). true se achou cliente e gravou. */
export async function optOutCustomerByPhone(companyId: string, phone: string | null | undefined, source = 'keyword'): Promise<boolean> {
  const end = phoneEnd(phone)
  if (!end) return false
  const cust = await prisma.customer.findFirst({
    where: { company_id: companyId, deleted_at: null, ...PHONE_OR(end) },
    select: { id: true },
  }).catch(() => null)
  if (!cust) return false
  await setCustomerConsent(cust.id, { opted_out: true, source })
  return true
}

/** Consulta opt-out por telefone (usado no gate de envio). Falha→false (não bloqueia por erro de leitura). */
export async function isPhoneOptedOut(companyId: string, phone: string | null | undefined): Promise<boolean> {
  const end = phoneEnd(phone)
  if (!end) return false
  const cust = await prisma.customer.findFirst({
    where: { company_id: companyId, deleted_at: null, ...PHONE_OR(end) },
    select: { custom_data: true },
  }).catch(() => null)
  return cust ? isOptedOut(cust.custom_data) : false
}

/** Captura opt-in de marketing (checkbox portal/OS). optedIn=false desativa. */
export async function setMarketingConsent(customerId: string, optedIn: boolean, source: string): Promise<void> {
  await setCustomerConsent(customerId, optedIn
    ? { marketing: true, marketing_source: source, marketing_at: new Date().toISOString() }
    : { marketing: false })
}

/**
 * Gate de marketing por cliente (Fase 4): true se pode enviar (opt-in + nao
 * opted_out + fora do cap de capDays). Ao permitir, registra last_marketing_at
 * (consome a janela — 1 tentativa por janela, conservador). Sem cliente/erro → false.
 */
export async function tryConsumeMarketing(companyId: string, phone: string | null | undefined, capDays = 7): Promise<boolean> {
  const end = phoneEnd(phone)
  if (!end) return false
  const cust = await prisma.customer.findFirst({
    where: { company_id: companyId, deleted_at: null, ...PHONE_OR(end) },
    select: { id: true, custom_data: true },
  }).catch(() => null)
  if (!cust) return false
  if (!marketingDecision(readConsent(cust.custom_data), Date.now(), capDays).allowed) return false
  await setCustomerConsent(cust.id, { last_marketing_at: new Date().toISOString() }).catch(() => {})
  return true
}
