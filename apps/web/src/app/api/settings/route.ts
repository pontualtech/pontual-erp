import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const updateSettingsSchema = z.object({
  settings: z.array(
    z.object({
      key: z.string().min(1),
      value: z.string(),
      type: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
      group: z.string().default('general'),
    })
  ),
})

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const where: Record<string, unknown> = { company_id: user.companyId }

    const settings = await prisma.setting.findMany({
      where,
      orderBy: { key: 'asc' },
    })

    // Chaves sensíveis que só admin pode ver
    const sensitiveKeyPrefixes = [
      'api_key', 'secret', 'password', 'token', 'credential',
      'boleto.', 'fiscal.api', 'chatwoot.token', 'encryption',
    ]
    const isAdmin = user.roleName === 'admin'

    // Agrupar por prefixo da key (ex: "general.theme" -> grupo "general")
    const grouped: Record<string, Record<string, { value: string; type: string | null }>> = {}
    for (const s of settings) {
      // Filtrar chaves sensíveis para não-admin
      if (!isAdmin) {
        const isSensitive = sensitiveKeyPrefixes.some(
          prefix => s.key.toLowerCase().includes(prefix)
        )
        if (isSensitive) continue
      }

      const parts = s.key.split('.')
      const group = parts.length > 1 ? parts[0] : 'general'
      if (!grouped[group]) grouped[group] = {}
      grouped[group][s.key] = { value: s.value, type: s.type }
    }

    return success(grouped)
  } catch (err) {
    return handleError(err)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const result = await requirePermission('core', 'edit')
    if (result instanceof NextResponse) return result
    const admin = result

    const body = await request.json()
    const { settings } = updateSettingsSchema.parse(body)

    const results = await prisma.$transaction(
      settings.map((s) =>
        prisma.setting.upsert({
          where: {
            company_id_key: { company_id: admin.companyId, key: s.key },
          },
          update: { value: s.value, type: s.type },
          create: {
            company_id: admin.companyId,
            key: s.key,
            value: s.value,
            type: s.type,
          },
        })
      )
    )

    logAudit({
      companyId: admin.companyId,
      userId: admin.id,
      module: 'core',
      action: 'update_settings',
      newValue: { keys: settings.map((s) => s.key) },
    })

    return success({ updated: results.length })
  } catch (err) {
    return handleError(err)
  }
}
