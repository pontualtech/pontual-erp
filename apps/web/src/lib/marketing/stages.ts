/**
 * Definição dos stages (fases do funil) do CRM Marketing.
 *
 * Source of truth: precisa bater com o mapping no trigger SQL
 * sync_os_status_to_marketing_tag (migration 20260514_marketing_triggers_upsert).
 *
 * Ordem visual no Kanban: leads → em serviço → atendidos → perdidos.
 */

export type StageKey =
  | 'lead_aguardando'
  | 'em_negociacao'
  | 'cliente_em_servico'
  | 'cliente_atendido'
  | 'perdido_recusou'

export interface StageDefinition {
  key: StageKey
  tag: string              // tag técnica completa (stage:KEY)
  label: string            // label humano
  description: string      // descrição curta pra header da coluna
  color: string            // cor base (gradient/badge)
  emoji: string
}

export const STAGES: StageDefinition[] = [
  {
    key: 'lead_aguardando',
    tag: 'stage:lead_aguardando',
    label: 'Aguardando aprovação',
    description: 'Orçamento enviado, aguardando cliente',
    color: 'amber',
    emoji: '⏳',
  },
  {
    key: 'em_negociacao',
    tag: 'stage:em_negociacao',
    label: 'Em negociação',
    description: 'Renegociação/orçamento recalculado',
    color: 'orange',
    emoji: '💬',
  },
  {
    key: 'cliente_em_servico',
    tag: 'stage:cliente_em_servico',
    label: 'Em serviço',
    description: 'OS aprovada, equipamento em manutenção',
    color: 'blue',
    emoji: '🔧',
  },
  {
    key: 'cliente_atendido',
    tag: 'stage:cliente_atendido',
    label: 'Cliente atendido',
    description: 'Serviço concluído e entregue',
    color: 'green',
    emoji: '✅',
  },
  {
    key: 'perdido_recusou',
    tag: 'stage:perdido_recusou',
    label: 'Perdido',
    description: 'Cancelado ou cliente recusou',
    color: 'gray',
    emoji: '✕',
  },
]

export const STAGE_KEYS: StageKey[] = STAGES.map(s => s.key)

export function getStage(key: string): StageDefinition | undefined {
  return STAGES.find(s => s.key === key)
}

export function getStageFromTag(tag: string): StageDefinition | undefined {
  if (!tag.startsWith('stage:')) return undefined
  return getStage(tag.slice(6))
}

/** Header gradient classes por cor — usado nas colunas do Kanban */
export function stageHeaderClasses(color: string): string {
  switch (color) {
    case 'amber':  return 'bg-gradient-to-b from-amber-50 to-transparent border-amber-300 dark:from-amber-500/10 dark:border-amber-500/30'
    case 'orange': return 'bg-gradient-to-b from-orange-50 to-transparent border-orange-300 dark:from-orange-500/10 dark:border-orange-500/30'
    case 'blue':   return 'bg-gradient-to-b from-blue-50 to-transparent border-blue-300 dark:from-blue-500/10 dark:border-blue-500/30'
    case 'green':  return 'bg-gradient-to-b from-green-50 to-transparent border-green-300 dark:from-green-500/10 dark:border-green-500/30'
    case 'gray':
    default:       return 'bg-gradient-to-b from-gray-50 to-transparent border-gray-300 dark:from-gray-500/10 dark:border-gray-500/30'
  }
}

/** Dot color pequeno usado nos badges/headers */
export function stageDotClasses(color: string): string {
  switch (color) {
    case 'amber':  return 'bg-amber-500'
    case 'orange': return 'bg-orange-500'
    case 'blue':   return 'bg-blue-500'
    case 'green':  return 'bg-green-500'
    case 'gray':
    default:       return 'bg-gray-400'
  }
}
