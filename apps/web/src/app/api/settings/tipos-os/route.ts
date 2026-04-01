import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

const SETTING_KEY = 'os.tipos'

/**
 * GET /api/settings/tipos-os — Lista tipos de OS
 */
export async function GET() {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const setting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
    })

    let tipos: { key: string; label: string }[] = []
    if (setting?.value) {
      try { tipos = JSON.parse(setting.value) } catch {}
    }

    // Se vazio, retornar defaults
    if (tipos.length === 0) {
      tipos = [
        { key: 'BALCAO', label: 'Balcao' },
        { key: 'COLETA', label: 'Coleta' },
      ]
      // Salvar defaults
      await prisma.setting.upsert({
        where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
        create: { company_id: user.companyId, key: SETTING_KEY, value: JSON.stringify(tipos), type: 'json' },
        update: { value: JSON.stringify(tipos) },
      })
    }

    return success(tipos)
  } catch (err) {
    return handleError(err)
  }
}

/**
 * POST /api/settings/tipos-os — Adicionar tipo
 * Body: { key: string, label: string }
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    if (!body.label?.trim()) return error('Nome do tipo e obrigatorio', 400)
    if (!body.key?.trim()) return error('Codigo e obrigatorio', 400)

    const setting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
    })

    let tipos: { key: string; label: string }[] = []
    if (setting?.value) {
      try { tipos = JSON.parse(setting.value) } catch {}
    }

    const key = body.key.trim().toUpperCase()
    if (tipos.some(t => t.key === key)) {
      return error(`Tipo "${key}" ja existe`, 400)
    }

    const novo = { key, label: body.label.trim() }
    tipos.push(novo)

    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
      create: { company_id: user.companyId, key: SETTING_KEY, value: JSON.stringify(tipos), type: 'json' },
      update: { value: JSON.stringify(tipos) },
    })

    return success(novo, 201)
  } catch (err) {
    return handleError(err)
  }
}

/**
 * DELETE /api/settings/tipos-os — Remover tipo
 * Body: { key: string }
 */
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

    let tipos: { key: string; label: string }[] = []
    if (setting?.value) {
      try { tipos = JSON.parse(setting.value) } catch {}
    }

    // Verificar se há OS usando este tipo
    const count = await prisma.serviceOrder.count({
      where: { company_id: user.companyId, os_type: body.key, deleted_at: null },
    })
    if (count > 0) {
      return error(`Nao pode remover: ${count} OS usam o tipo "${body.key}"`, 400)
    }

    tipos = tipos.filter(t => t.key !== body.key)

    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key: SETTING_KEY } },
      create: { company_id: user.companyId, key: SETTING_KEY, value: JSON.stringify(tipos), type: 'json' },
      update: { value: JSON.stringify(tipos) },
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
