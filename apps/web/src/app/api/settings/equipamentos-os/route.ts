import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

const SETTING_KEY = 'os.equipamentos'

export async function GET() {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const setting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
    })

    let items: string[] = []
    if (setting?.value) { try { items = JSON.parse(setting.value) } catch {} }

    if (items.length === 0) {
      items = ['Impressora', 'Notebook', 'Termica', 'Multifuncional', 'Plotter', 'Scanner', 'Computador', 'Monitor']
      await prisma.setting.upsert({
        where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
        create: { company_id: user.companyId, key: SETTING_KEY, value: JSON.stringify(items), type: 'json' },
        update: { value: JSON.stringify(items) },
      })
    }

    return success(items)
  } catch (err) { return handleError(err) }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    if (!body.name?.trim()) return error('Nome obrigatorio', 400)

    const setting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
    })

    let items: string[] = []
    if (setting?.value) { try { items = JSON.parse(setting.value) } catch {} }

    const name = body.name.trim()
    if (items.some(i => i.toLowerCase() === name.toLowerCase())) return error(`"${name}" ja existe`, 400)

    items.push(name)

    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
      create: { company_id: user.companyId, key: SETTING_KEY, value: JSON.stringify(items), type: 'json' },
      update: { value: JSON.stringify(items) },
    })

    return success(name, 201)
  } catch (err) { return handleError(err) }
}

export async function DELETE(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    if (!body.name) return error('Nome obrigatorio', 400)

    const setting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
    })

    let items: string[] = []
    if (setting?.value) { try { items = JSON.parse(setting.value) } catch {} }

    items = items.filter(i => i !== body.name)

    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
      create: { company_id: user.companyId, key: SETTING_KEY, value: JSON.stringify(items), type: 'json' },
      update: { value: JSON.stringify(items) },
    })

    return success({ deleted: true })
  } catch (err) { return handleError(err) }
}
