/**
 * Nurture playbook — roteiro de sequência perpétua pra leads que recusaram OS.
 *
 * Como funciona:
 *  - Cada step tem `day` (dias desde started_at) e canal (email | wa).
 *  - O cron diário calcula daysSinceStart e pega o próximo step não-enviado.
 *  - Após esgotar steps fixos, entra em LOOP perpétuo via `repeat_every_days`.
 *
 * Editar copy/dias: muda esse arquivo + redeploy. Sem migration.
 */

export type NurtureChannel = 'email' | 'wa'

export interface NurtureStep {
  /** Dias desde started_at quando deve disparar */
  day: number
  channel: NurtureChannel
  /** Nome do template (WA Meta Cloud) ou path do HTML (email) */
  template: string
  /** Subject do email (ignorado se channel='wa') */
  subject?: string
  /** Categoria Meta — UTILITY (não-comercial) ou MARKETING. Default UTILITY (passa aprovação mais fácil). */
  meta_category?: 'UTILITY' | 'MARKETING'
  /** Foco do step pra dashboard (printer | notebook | both | empathy | followup | survey) */
  focus: 'empathy' | 'printer' | 'notebook' | 'both' | 'survey' | 'followup'
  /** Descrição curta humana pra UI/admin */
  label: string
}

export interface NurtureRecurringStep {
  /** Step recorrente após esgotar steps fixos. day_start = primeiro fire */
  day_start: number
  repeat_every_days: number
  channel: NurtureChannel
  /** Pool de templates — cron escolhe rotativo (round-robin por iteração) */
  template_pool: string[]
  /** Subject pool correspondente (paralelo a template_pool) */
  subject_pool?: string[]
  focus: NurtureStep['focus']
  label: string
}

export interface NurturePlaybook {
  type: string
  description: string
  steps: NurtureStep[]
  recurring?: NurtureRecurringStep
}

// ─────────────────────────────────────────────
// Playbook RECUSED_OS — lead que disse "não" ao orçamento
// ─────────────────────────────────────────────
export const RECUSED_OS_PLAYBOOK: NurturePlaybook = {
  type: 'recused_os',
  description: 'Sequência pós-recusa de orçamento. Empatia → valor → cross-sell notebook → soft offer → pesquisa → loop mensal.',
  steps: [
    {
      day: 1,
      channel: 'wa',
      template: 'nurture_d1_empathy',
      meta_category: 'UTILITY',
      focus: 'empathy',
      label: 'WA empático — sem pressão',
    },
    {
      day: 3,
      channel: 'email',
      template: 'email2_dicas_impressora.html',
      subject: '3 sinais silenciosos que matam sua impressora',
      focus: 'printer',
      label: 'Email dica técnica impressora',
    },
    {
      day: 7,
      channel: 'wa',
      template: 'nurture_d7_checkin',
      meta_category: 'UTILITY',
      focus: 'followup',
      label: 'WA check-in pós primeiro touch',
    },
    {
      day: 15,
      channel: 'email',
      template: 'newsletter_notebook_pontualtech.html',
      subject: 'Você sabia? Agora também consertamos notebook (10% off)',
      focus: 'notebook',
      label: 'Email cross-sell notebook (introduz produto 2)',
    },
    {
      day: 22,
      channel: 'email',
      template: 'nurture_d22_caso.html',
      subject: 'Cliente economizou R$ 380 com revisão preventiva — veja como',
      focus: 'printer',
      label: 'Email caso/prova social',
    },
    {
      day: 30,
      channel: 'email',
      template: 'nurture_d30_offer.html',
      subject: 'Seu cupom 10% ainda vale — impressora ou notebook',
      focus: 'both',
      label: 'Email soft offer ambos equipamentos',
    },
    {
      day: 45,
      channel: 'wa',
      template: 'nurture_d45_pesquisa',
      meta_category: 'MARKETING',
      focus: 'survey',
      label: 'WA pesquisa — o que faltou pra fechar',
    },
  ],
  recurring: {
    day_start: 60,
    repeat_every_days: 30,
    channel: 'email',
    template_pool: [
      'nurture_recurring_dica.html',
      'nurture_recurring_case.html',
      'nurture_recurring_novidade.html',
    ],
    subject_pool: [
      'Dica do mês PontualTech',
      'Cliente recuperou equipamento que ia trocar',
      'Novidade pra cliente PT',
    ],
    focus: 'both',
    label: 'Loop mensal perpétuo (rotativo)',
  },
}

// Mapa nome → playbook (futuras journey types se adicionar)
export const PLAYBOOKS: Record<string, NurturePlaybook> = {
  recused_os: RECUSED_OS_PLAYBOOK,
}

/**
 * Calcula qual step deve ser executado dado current_step + days_since_start.
 *
 * Retorna { step, isRecurring, recurringIteration } ou null se ainda não é hora
 * (cron espera próxima rodada).
 */
export function getStepToExecute(
  playbook: NurturePlaybook,
  currentStep: number,
  daysSinceStart: number,
): { step: NurtureStep | NurtureRecurringStep; isRecurring: boolean; recurringIteration?: number } | null {
  // Steps fixos ainda não consumidos
  if (currentStep < playbook.steps.length) {
    const next = playbook.steps[currentStep]
    if (daysSinceStart >= next.day) {
      return { step: next, isRecurring: false }
    }
    return null
  }

  // Entrou no loop perpétuo
  if (!playbook.recurring) return null

  const r = playbook.recurring
  if (daysSinceStart < r.day_start) return null

  // Quantas iterações recorrentes já passaram desde day_start
  const daysIntoRecurring = daysSinceStart - r.day_start
  const iterationsExpectedRaw = Math.floor(daysIntoRecurring / r.repeat_every_days) + 1

  // currentStep além de steps.length = quantas iterações recorrentes já enviadas
  const iterationsSent = currentStep - playbook.steps.length

  // Anti-catch-up flood: se o cron ficou parado por meses e voltou, NÃO disparar
  // todas as iterações atrasadas de uma vez. Dispara só +1 por tick — recupera
  // gradualmente. Evita inundar cliente em 1 dia.
  const iterationsExpected = Math.min(iterationsExpectedRaw, iterationsSent + 1)

  if (iterationsExpected > iterationsSent) {
    return { step: r, isRecurring: true, recurringIteration: iterationsSent }
  }

  return null
}
