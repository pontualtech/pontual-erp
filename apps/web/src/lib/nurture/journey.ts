/**
 * Nurture journey helpers — orquestra captura, próximo step, e detect reativação.
 *
 * Camadas:
 *  - createOrUpdateJourney(): chamado pelo endpoint capture (bot)
 *  - getActiveJourneys(): cron pega quem deve ser processado
 *  - recordStepSent(): após disparar email/wa, incrementa step
 *  - computeOutcome(): cruza com service_orders pra detectar reativação
 */

import { prisma } from '@pontual/db'
import { PLAYBOOKS, getStepToExecute, type NurturePlaybook, type NurtureStep, type NurtureRecurringStep } from './playbook'

export interface CaptureInput {
  company_id: string
  email: string
  phone?: string
  name?: string
  journey_type?: string  // default 'recused_os'
  source_data?: Record<string, unknown>
}

export interface JourneyWithContact {
  id: string
  contact_id: string
  company_id: string
  journey_type: string
  current_step: number
  started_at: Date
  last_step_at: Date | null
  ended_at: Date | null
  outcome: string | null
  source_data: any
  contact: {
    id: string
    email: string
    phone: string | null
    name: string | null
    unsubscribed: boolean
    bounce_count: number
  }
}

/**
 * Captura/atualiza um lead. Idempotente: se já existe journey ativa, retorna ela.
 * Se contato não existe em marketing_contacts, cria também.
 *
 * Source comum: bot chama quando cliente recusa OS e fornece email.
 */
export async function createOrUpdateJourney(input: CaptureInput): Promise<{
  journey_id: string
  contact_id: string
  is_new: boolean
}> {
  const journeyType = input.journey_type || 'recused_os'
  const email = input.email.toLowerCase().trim()
  if (!email || !email.includes('@')) {
    throw new Error('Email inválido')
  }

  // 1. Upsert do contato
  // Composite unique key no Prisma: nome é <field1>_<field2> (não o `map` do schema)
  const tagToAdd = `nurture:${journeyType}`
  const contact = await prisma.marketingContact.upsert({
    where: {
      company_id_email: {
        company_id: input.company_id,
        email,
      },
    },
    update: {
      // Só atualiza se passou phone/name novos (não sobrescreve com null)
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.name ? { name: input.name } : {}),
      last_seen_at: new Date(),
      // NÃO usar `tags: { push }` aqui — duplicaria tag a cada re-captura.
      // Dedup feito num update separado abaixo após o upsert.
    },
    create: {
      company_id: input.company_id,
      email,
      phone: input.phone || null,
      name: input.name || null,
      origin: 'bot_capture',
      tags: [tagToAdd],
    },
  })

  // Dedup tag: adiciona só se não tiver. Postgres array_append não dedupa,
  // então check em JS e update condicional.
  if (!contact.tags.includes(tagToAdd)) {
    await prisma.marketingContact.update({
      where: { id: contact.id },
      data: { tags: [...contact.tags, tagToAdd] },
    })
  }

  // 2. Upsert da journey — UNIQUE(contact_id, journey_type) garante 1 ativa
  const existing = await prisma.marketingJourney.findUnique({
    where: {
      contact_id_journey_type: {
        contact_id: contact.id,
        journey_type: journeyType,
      },
    },
  })

  if (existing) {
    // Se concluída, NÃO reabre automático (decisão de produto — evita duplo disparo).
    // Se ativa, atualiza source_data com merge.
    if (existing.ended_at === null) {
      await prisma.marketingJourney.update({
        where: { id: existing.id },
        data: {
          source_data: {
            ...(existing.source_data as object || {}),
            ...(input.source_data || {}),
            last_capture_at: new Date().toISOString(),
          },
        },
      })
    }
    return { journey_id: existing.id, contact_id: contact.id, is_new: false }
  }

  // 3. Cria nova
  const journey = await prisma.marketingJourney.create({
    data: {
      contact_id: contact.id,
      company_id: input.company_id,
      journey_type: journeyType,
      current_step: 0,
      source_data: (input.source_data || {}) as any,
    },
  })

  return { journey_id: journey.id, contact_id: contact.id, is_new: true }
}

/**
 * Pega journeys ativas (ended_at NULL) — limite alto pra processar tudo num
 * tick. Inclui contact pra evitar N+1.
 */
export async function getActiveJourneys(
  companyId?: string,
  limit = 500,
): Promise<JourneyWithContact[]> {
  const where: any = { ended_at: null }
  if (companyId) where.company_id = companyId
  return prisma.marketingJourney.findMany({
    where,
    include: {
      contact: {
        select: {
          id: true, email: true, phone: true, name: true,
          unsubscribed: true, bounce_count: true,
        },
      },
    },
    take: limit,
    orderBy: { started_at: 'asc' },
  }) as any
}

/**
 * Avalia se um journey deve receber algum step agora.
 * Retorna o step (e flag recurring) ou null se ainda não é hora / esgotou.
 */
export function evaluateNextStep(j: JourneyWithContact): {
  step: NurtureStep | NurtureRecurringStep
  isRecurring: boolean
  recurringIteration?: number
} | null {
  const playbook = PLAYBOOKS[j.journey_type]
  if (!playbook) return null
  const daysSince = Math.floor((Date.now() - new Date(j.started_at).getTime()) / 86400000)
  return getStepToExecute(playbook, j.current_step, daysSince)
}

/**
 * Marca step como enviado: incrementa current_step + grava last_step_at.
 * Se step recorrente, current_step também incrementa (cada iteração = +1).
 *
 * Anti-race: requer expectedStep — só atualiza se current_step ainda for o
 * esperado. Se outro processo já incrementou (2 crons concorrentes), retorna
 * false e o caller pula o envio.
 */
export async function recordStepSent(
  journeyId: string,
  expectedStep: number,
): Promise<boolean> {
  const r = await prisma.marketingJourney.updateMany({
    where: { id: journeyId, current_step: expectedStep, ended_at: null },
    data: {
      current_step: { increment: 1 },
      last_step_at: new Date(),
    },
  })
  return r.count === 1
}

/**
 * Encerra journey com outcome — usado quando detecta reativação, unsubscribe ou bounce duro.
 */
export async function endJourney(journeyId: string, outcome: string): Promise<void> {
  await prisma.marketingJourney.update({
    where: { id: journeyId },
    data: {
      ended_at: new Date(),
      outcome,
    },
  })
}

/**
 * Detecta reativação: cliente abriu uma service_order DEPOIS de started_at.
 * Match por customer.email (ou marketing_contact.customer_id se já linkado).
 *
 * Retorna lista de journeys que devem ser fechadas com outcome='reactivated'.
 */
export async function detectReactivations(): Promise<{ journey_id: string; os_id: string }[]> {
  // Query: para cada journey ativa, busca service_order do mesmo company_id
  // criada após started_at onde o customer.email bate com contact.email.
  const result = await prisma.$queryRaw<Array<{ journey_id: string; os_id: string }>>`
    SELECT
      mj.id AS journey_id,
      so.id AS os_id
    FROM marketing_journeys mj
    JOIN marketing_contacts mc ON mc.id = mj.contact_id
    JOIN customers cu ON LOWER(cu.email) = mc.email AND cu.company_id = mj.company_id
    JOIN service_orders so ON so.customer_id = cu.id
      AND so.created_at > mj.started_at
      AND so.company_id = mj.company_id
    WHERE mj.ended_at IS NULL
    LIMIT 1000
  `
  return result
}
