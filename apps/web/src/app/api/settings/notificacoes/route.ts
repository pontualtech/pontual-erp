import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * Notification rules per status transition.
 * Stored as individual settings: notif.rule.{status_id} = JSON
 *
 * Rule format:
 * {
 *   mode: 'auto' | 'manual' | 'off',
 *   email: boolean,
 *   whatsapp: boolean,
 *   email_subject: string,     // custom subject (optional)
 *   email_message: string,     // custom message body (optional)
 *   whatsapp_message: string,  // custom WhatsApp text (optional)
 * }
 */

export interface NotifRule {
  mode: 'auto' | 'manual' | 'off'
  email: boolean
  whatsapp: boolean
  email_subject: string
  email_message: string
  whatsapp_message: string
}

// Default for new/unconfigured statuses: manual (safe — admin must explicitly enable auto)
const DEFAULT_RULE: NotifRule = {
  mode: 'manual',
  email: true,
  whatsapp: true,
  email_subject: '',
  email_message: '',
  whatsapp_message: '',
}

/**
 * GET /api/settings/notificacoes — Load all notification rules + statuses
 */
export async function GET() {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Load all OS statuses for this company
    const statuses = await prisma.moduleStatus.findMany({
      where: { company_id: user.companyId, module: 'os' },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, color: true, order: true, is_final: true },
    })

    // Load notification rules from settings
    const settings = await prisma.setting.findMany({
      where: {
        company_id: user.companyId,
        key: { startsWith: 'notif.rule.' },
      },
    })

    const rules: Record<string, NotifRule> = {}
    for (const s of settings) {
      const statusId = s.key.replace('notif.rule.', '')
      try {
        rules[statusId] = { ...DEFAULT_RULE, ...JSON.parse(s.value) }
      } catch {
        rules[statusId] = { ...DEFAULT_RULE }
      }
    }

    // Load global notification permission setting
    const permSetting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: user.companyId, key: 'notif.permission_required' } },
    })

    return success({
      statuses,
      rules,
      default_rule: DEFAULT_RULE,
      permission_required: permSetting?.value || 'os:edit',
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * PUT /api/settings/notificacoes — Save notification rules
 */
export async function PUT(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const { rules, permission_required } = body as {
      rules: Record<string, NotifRule>
      permission_required?: string
    }

    // Save each rule as a setting
    for (const [statusId, rule] of Object.entries(rules || {})) {
      const key = `notif.rule.${statusId}`
      await prisma.setting.upsert({
        where: { company_id_key: { company_id: user.companyId, key } },
        create: { company_id: user.companyId, key, value: JSON.stringify(rule), type: 'json' },
        update: { value: JSON.stringify(rule) },
      })
    }

    // Save permission setting
    if (permission_required) {
      await prisma.setting.upsert({
        where: { company_id_key: { company_id: user.companyId, key: 'notif.permission_required' } },
        create: { company_id: user.companyId, key: 'notif.permission_required', value: permission_required, type: 'string' },
        update: { value: permission_required },
      })
    }

    return success({ saved: true })
  } catch (err) {
    return handleError(err)
  }
}
