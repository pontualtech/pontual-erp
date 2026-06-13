import { prisma } from '@pontual/db'
import { resolveAllowedWidgets, type RoleWidgetSetting } from './widget-catalog'

// Setting (por empresa) que guarda a matriz perfil->bloco controlada pelo admin.
export const ROLE_WIDGETS_SETTING_KEY = 'dashboard.role_widgets'

export async function loadRoleWidgetSetting(companyId: string): Promise<RoleWidgetSetting | null> {
  const s = await prisma.setting.findFirst({
    where: { company_id: companyId, key: ROLE_WIDGETS_SETTING_KEY },
    select: { value: true },
  }).catch(() => null)
  if (!s?.value) return null
  try {
    const parsed = JSON.parse(s.value)
    return parsed && typeof parsed === 'object' ? (parsed as RoleWidgetSetting) : null
  } catch {
    return null
  }
}

/** Blocos que o usuário atual PODE ver (admin/superadmin = tudo). */
export async function getAllowedWidgetsForUser(user: {
  roleId: string
  companyId: string
  isSuperAdmin: boolean
}): Promise<string[]> {
  const setting = await loadRoleWidgetSetting(user.companyId)
  return resolveAllowedWidgets(user.roleId, setting, { isSuperAdmin: user.isSuperAdmin })
}
