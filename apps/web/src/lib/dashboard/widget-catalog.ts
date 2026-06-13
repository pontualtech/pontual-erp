// Catálogo central dos blocos (widgets) do dashboard + resolução de quais
// blocos cada PERFIL pode ver (camada controlada pelo admin, em cima da
// personalização por usuário). Eco audit 13/06: dashboard não era diferenciado
// por perfil — atendente via métricas gerenciais. Admin agora libera/bloqueia
// blocos por role em /config/dashboard-perfis.

export interface WidgetDef {
  id: string
  label: string
  // "gerencial" = bloco que, por padrão, some pros perfis operacionais.
  management: boolean
}

export const WIDGET_CATALOG: WidgetDef[] = [
  { id: 'avisos', label: 'Avisos', management: false },
  { id: 'summary_cards', label: 'Cards de Resumo (OS)', management: false },
  { id: 'insights', label: 'Insights — pontos de atenção', management: false },
  { id: 'chart_os_week', label: 'Gráfico OS por Semana', management: false },
  { id: 'chart_pipeline', label: 'Pipeline de OS', management: false },
  { id: 'recent_os', label: 'Últimas OS', management: false },
  { id: 'metrics', label: 'Métricas (tempo médio, taxa de aprovação)', management: true },
  { id: 'tech_workload', label: 'Carga de Trabalho dos Técnicos', management: true },
  { id: 'receivables', label: 'Contas a Receber (resumo)', management: true },
  { id: 'charges_summary', label: 'Resumo de Cobranças', management: true },
  { id: 'marketing_card', label: 'Marketing', management: true },
]

export const ALL_WIDGET_IDS: string[] = WIDGET_CATALOG.map(w => w.id)
export const MANAGEMENT_WIDGET_IDS: string[] = WIDGET_CATALOG.filter(w => w.management).map(w => w.id)

// setting `dashboard.role_widgets`: { [roleId]: { [widgetId]: boolean } }
export type RoleWidgetSetting = Record<string, Record<string, boolean>>

export function isAdminLikeRole(roleId?: string | null): boolean {
  if (!roleId) return false
  const r = roleId.toLowerCase()
  return r.includes('admin') || r.includes('administrador')
}

/**
 * Allow-list padrão (seed) quando o admin ainda não configurou aquele perfil.
 *  - admin-like → tudo
 *  - financeiro → tudo menos marketing
 *  - operacional (atendente/técnico/motorista/suporte/desconhecido) → tudo menos os gerenciais
 */
export function defaultAllowedForRole(roleId?: string | null): string[] {
  if (isAdminLikeRole(roleId)) return [...ALL_WIDGET_IDS]
  const r = (roleId || '').toLowerCase()
  if (r.includes('financ')) return ALL_WIDGET_IDS.filter(id => id !== 'marketing_card')
  return ALL_WIDGET_IDS.filter(id => !MANAGEMENT_WIDGET_IDS.includes(id))
}

/**
 * Resolve os blocos que o perfil PODE ver. Admin/SuperAdmin sempre veem tudo.
 * Pro restante: usa o setting do admin (true/false por bloco); blocos não
 * mencionados no setting caem no default do perfil (forward-compat p/ blocos novos).
 */
export function resolveAllowedWidgets(
  roleId: string | null | undefined,
  setting: RoleWidgetSetting | null | undefined,
  opts?: { isSuperAdmin?: boolean },
): string[] {
  if (opts?.isSuperAdmin || isAdminLikeRole(roleId)) return [...ALL_WIDGET_IDS]

  const roleCfg = setting && roleId ? setting[roleId] : undefined
  if (!roleCfg) return defaultAllowedForRole(roleId)

  const def = new Set(defaultAllowedForRole(roleId))
  return ALL_WIDGET_IDS.filter(id => (id in roleCfg ? roleCfg[id] === true : def.has(id)))
}
