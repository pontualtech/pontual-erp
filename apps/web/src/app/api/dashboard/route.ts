import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

export async function GET() {
  try {
    const user = await getServerUser()
    if (!user) return error('Não autenticado', 401)

    // Buscar widgets do usuário
    const widgets = await prisma.dashboardWidget.findMany({
      where: { company_id: user.companyId, user_id: user.id, is_active: true },
      orderBy: { created_at: 'asc' },
    })

    // Se não tem widgets, retornar defaults baseados no role
    if (widgets.length === 0) {
      const defaults = getDefaultWidgets(user.roleName)
      return success({ widgets: defaults, isDefault: true })
    }

    // Calcular dados dos widgets
    const widgetData = await Promise.all(
      widgets.map(async (widget) => {
        const data = await resolveWidgetData(widget.widget_type, user.companyId)
        return {
          id: widget.id,
          widgetType: widget.widget_type,
          title: widget.title,
          config: widget.config,
          position: widget.position,
          data,
        }
      })
    )

    return success({ widgets: widgetData, isDefault: false })
  } catch (err) {
    return handleError(err)
  }
}

function getDefaultWidgets(roleName: string) {
  const base = [
    { widgetType: 'total_users', title: 'Usuários Ativos', type: 'stat' },
    { widgetType: 'recent_activity', title: 'Atividade Recente', type: 'list' },
  ]

  if (roleName === 'admin') {
    return [
      ...base,
      { widgetType: 'active_modules', title: 'Módulos Ativos', type: 'stat' },
      { widgetType: 'roles_overview', title: 'Cargos', type: 'chart' },
      { widgetType: 'audit_summary', title: 'Auditoria (7 dias)', type: 'chart' },
    ]
  }

  return base
}

async function resolveWidgetData(widgetType: string, companyId: string) {
  switch (widgetType) {
    case 'total_users': {
      const count = await prisma.userProfile.count({
        where: { company_id: companyId, is_active: true },
      })
      return { value: count }
    }
    case 'active_modules': {
      const count = await prisma.companyModule.count({
        where: { company_id: companyId, is_active: true },
      })
      return { value: count }
    }
    case 'roles_overview': {
      const roles = await prisma.role.findMany({
        where: { company_id: companyId, is_active: true },
        include: { _count: { select: { user_profiles: true } } },
        orderBy: { name: 'asc' },
      })
      return {
        items: roles.map((r) => ({ name: r.name, userCount: r._count.user_profiles })),
      }
    }
    case 'recent_activity': {
      const logs = await prisma.auditLog.findMany({
        where: { company_id: companyId },
        orderBy: { created_at: 'desc' },
        take: 10,
      })
      return {
        items: logs.map((l) => ({
          module: l.module,
          action: l.action,
          createdAt: l.created_at,
        })),
      }
    }
    case 'audit_summary': {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      const count = await prisma.auditLog.count({
        where: { company_id: companyId, created_at: { gte: sevenDaysAgo } },
      })
      return { value: count, period: '7d' }
    }
    default:
      return null
  }
}
