import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

/**
 * Dashboard widget preferences stored in UserProfile.preferences.dashboard
 *
 * Shape: { widgets: Array<{ id: string; visible: boolean }> }
 *
 * Widget IDs: summary_cards, chart_os_week, chart_pipeline,
 *             metrics, recent_os, receivables, tech_workload, avisos
 */

// Default widget order (all visible)
const DEFAULT_WIDGETS = [
  { id: 'avisos', visible: true },
  { id: 'summary_cards', visible: true },
  { id: 'chart_os_week', visible: true },
  { id: 'chart_pipeline', visible: true },
  { id: 'metrics', visible: true },
  { id: 'recent_os', visible: true },
  { id: 'receivables', visible: true },
  { id: 'tech_workload', visible: true },
]

export async function GET() {
  try {
    const user = await getServerUser()
    if (!user) return error('Nao autenticado', 401)

    const profile = await prisma.userProfile.findUnique({
      where: { id: user.id },
      select: { preferences: true },
    })

    const prefs = (profile?.preferences as Record<string, any>) || {}
    const dashboardPrefs = prefs.dashboard || { widgets: DEFAULT_WIDGETS }

    return success(dashboardPrefs)
  } catch (err) {
    return handleError(err)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getServerUser()
    if (!user) return error('Nao autenticado', 401)

    const body = await req.json()
    const widgets = body.widgets

    if (!Array.isArray(widgets)) {
      return error('widgets deve ser um array', 400)
    }

    // Validate widget IDs
    const validIds = new Set(DEFAULT_WIDGETS.map(w => w.id))
    for (const w of widgets) {
      if (!validIds.has(w.id)) {
        return error(`Widget desconhecido: ${w.id}`, 400)
      }
    }

    // Read current preferences and merge
    const profile = await prisma.userProfile.findUnique({
      where: { id: user.id },
      select: { preferences: true },
    })

    const currentPrefs = (profile?.preferences as Record<string, any>) || {}
    const updatedPrefs = { ...currentPrefs, dashboard: { widgets } }

    await prisma.userProfile.update({
      where: { id: user.id },
      data: { preferences: updatedPrefs },
    })

    return success({ widgets })
  } catch (err) {
    return handleError(err)
  }
}
