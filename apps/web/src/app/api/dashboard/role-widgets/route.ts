import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import {
  WIDGET_CATALOG,
  ALL_WIDGET_IDS,
  resolveAllowedWidgets,
  isAdminLikeRole,
  type RoleWidgetSetting,
} from '@/lib/dashboard/widget-catalog'
import { loadRoleWidgetSetting, ROLE_WIDGETS_SETTING_KEY } from '@/lib/dashboard/role-widgets-server'

/**
 * GET — matriz efetiva (perfil x bloco) pra tela /config/dashboard-perfis.
 * Retorna o catálogo + roles da empresa + o que cada role PODE ver hoje
 * (setting salvo OU default sensato). Admin-like vem marcado como locked.
 */
export async function GET() {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const [roles, setting] = await Promise.all([
      prisma.role.findMany({
        where: { company_id: user.companyId, is_active: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      loadRoleWidgetSetting(user.companyId),
    ])

    const matrix = roles.map(r => {
      const adminLike = isAdminLikeRole(r.id) || isAdminLikeRole(r.name)
      const allowed = new Set(
        adminLike ? ALL_WIDGET_IDS : resolveAllowedWidgets(r.id, setting),
      )
      return {
        roleId: r.id,
        roleName: r.name,
        locked: adminLike, // admin sempre vê tudo
        widgets: Object.fromEntries(ALL_WIDGET_IDS.map(id => [id, allowed.has(id)])),
      }
    })

    return success({ catalog: WIDGET_CATALOG, matrix })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * PUT — salva a matriz. Body: { matrix: { [roleId]: { [widgetId]: boolean } } }.
 * Ignora roles admin-like (sempre tudo) e widgets fora do catálogo.
 */
export async function PUT(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const admin = result

    const body = await req.json()
    const incoming = body?.matrix
    if (!incoming || typeof incoming !== 'object') {
      return error('matrix deve ser um objeto { roleId: { widgetId: bool } }', 400)
    }

    const validWidget = new Set(ALL_WIDGET_IDS)
    const clean: RoleWidgetSetting = {}
    for (const [roleId, widgets] of Object.entries(incoming)) {
      if (isAdminLikeRole(roleId)) continue // admin não é restringível
      if (!widgets || typeof widgets !== 'object') continue
      const roleCfg: Record<string, boolean> = {}
      for (const [wid, val] of Object.entries(widgets as Record<string, unknown>)) {
        if (validWidget.has(wid)) roleCfg[wid] = val === true
      }
      if (Object.keys(roleCfg).length > 0) clean[roleId] = roleCfg
    }

    await prisma.setting.upsert({
      where: { company_id_key: { company_id: admin.companyId, key: ROLE_WIDGETS_SETTING_KEY } },
      update: { value: JSON.stringify(clean), type: 'json' },
      create: {
        company_id: admin.companyId,
        key: ROLE_WIDGETS_SETTING_KEY,
        value: JSON.stringify(clean),
        type: 'json',
      },
    })

    logAudit({
      companyId: admin.companyId,
      userId: admin.id,
      module: 'core',
      action: 'update_dashboard_role_widgets',
      newValue: { roles: Object.keys(clean) },
    })

    return success({ saved: Object.keys(clean).length })
  } catch (err) {
    return handleError(err)
  }
}
