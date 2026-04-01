import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

const SETTING_KEY = 'os.locais'

export async function GET() {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const setting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
    })

    let locais: { key: string; label: string }[] = []
    if (setting?.value) {
      try { locais = JSON.parse(setting.value) } catch {}
    }

    if (locais.length === 0) {
      locais = [
        { key: 'LOJA', label: 'Loja' },
        { key: 'EXTERNO', label: 'Externo' },
      ]
      await prisma.setting.upsert({
        where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
        create: { company_id: user.companyId, key: SETTING_KEY, value: JSON.stringify(locais), type: 'json' },
        update: { value: JSON.stringify(locais) },
      })
    }

    return success(locais)
  } catch (err) { return handleError(err) }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    if (!body.label?.trim()) return error('Nome e obrigatorio', 400)

    const setting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
    })

    let locais: { key: string; label: string }[] = []
    if (setting?.value) { try { locais = JSON.parse(setting.value) } catch {} }

    const key = (body.key || body.label).trim().toUpperCase().replace(/\s+/g, '_')
    if (locais.some(t => t.key === key)) return error(`Local "${key}" ja existe`, 400)

    const novo = { key, label: body.label.trim() }
    locais.push(novo)

    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
      create: { company_id: user.companyId, key: SETTING_KEY, value: JSON.stringify(locais), type: 'json' },
      update: { value: JSON.stringify(locais) },
    })

    return success(novo, 201)
  } catch (err) { return handleError(err) }
}

export async function DELETE(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    if (!body.key) return error('Key obrigatorio', 400)

    const setting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
    })

    let locais: { key: string; label: string }[] = []
    if (setting?.value) { try { locais = JSON.parse(setting.value) } catch {} }

    const count = await prisma.serviceOrder.count({
      where: { company_id: user.companyId, os_location: body.key, deleted_at: null },
    })
    if (count > 0) return error(`Nao pode remover: ${count} OS usam o local "${body.key}"`, 400)

    locais = locais.filter(t => t.key !== body.key)

    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
      create: { company_id: user.companyId, key: SETTING_KEY, value: JSON.stringify(locais), type: 'json' },
      update: { value: JSON.stringify(locais) },
    })

    return success({ deleted: true })
  } catch (err) { return handleError(err) }
}
