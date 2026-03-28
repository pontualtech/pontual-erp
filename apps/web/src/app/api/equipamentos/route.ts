import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

const MARCA_PREFIX = 'marca.'
const MODELO_PREFIX = 'modelo.'

const DEFAULT_BRANDS = [
  'Epson', 'HP', 'Canon', 'Brother', 'Elgin', 'Bematech',
  'Lexmark', 'Xerox', 'Ricoh', 'Kyocera', 'Samsung', 'OKI', 'Zebra', 'Argox',
]

const DEFAULT_MODELS: Record<string, string[]> = {
  HP: ['LaserJet Pro M404', 'LaserJet Pro M428', 'LaserJet P1102', 'DeskJet 2774', 'OfficeJet Pro 9015'],
  Epson: ['L3150', 'L3250', 'L4260', 'L1250', 'EcoTank L355', 'L395', 'L380', 'L120'],
  Brother: ['DCP-L2540DW', 'HL-L2350DW', 'MFC-L2740DW', 'DCP-T520W'],
}

async function seedDefaults(companyId: string) {
  // Check if brands already seeded
  const existing = await prisma.setting.findFirst({
    where: { company_id: companyId, key: { startsWith: MARCA_PREFIX } },
  })
  if (existing) return

  const ops: any[] = []

  // Seed brands
  for (const brand of DEFAULT_BRANDS) {
    ops.push(
      prisma.setting.create({
        data: {
          company_id: companyId,
          key: `${MARCA_PREFIX}${brand}`,
          value: brand,
          type: 'string',
        },
      })
    )
  }

  // Seed models
  for (const [brand, models] of Object.entries(DEFAULT_MODELS)) {
    for (const model of models) {
      ops.push(
        prisma.setting.create({
          data: {
            company_id: companyId,
            key: `${MODELO_PREFIX}${brand}.${model}`,
            value: model,
            type: 'string',
          },
        })
      )
    }
  }

  await prisma.$transaction(ops)
}

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const type = url.get('type') // 'marcas' or 'modelos'
    const marca = url.get('marca') // brand name for filtering models

    // Seed defaults on first access
    await seedDefaults(user.companyId)

    if (type === 'modelos' && marca) {
      const prefix = `${MODELO_PREFIX}${marca}.`
      const settings = await prisma.setting.findMany({
        where: { company_id: user.companyId, key: { startsWith: prefix } },
        orderBy: { value: 'asc' },
      })
      const modelos = settings.map(s => s.value)
      return success(modelos)
    }

    // Default: return brands
    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { startsWith: MARCA_PREFIX } },
      orderBy: { value: 'asc' },
    })
    const marcas = settings.map(s => s.value)
    return success(marcas)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const { type, marca, value } = body

    if (!value?.trim()) return error('Valor e obrigatorio', 400)

    if (type === 'modelo') {
      if (!marca?.trim()) return error('Marca e obrigatoria para adicionar modelo', 400)
      const key = `${MODELO_PREFIX}${marca.trim()}.${value.trim()}`

      // Check if already exists
      const existing = await prisma.setting.findFirst({
        where: { company_id: user.companyId, key },
      })
      if (existing) return error('Modelo ja cadastrado', 409)

      await prisma.setting.create({
        data: {
          company_id: user.companyId,
          key,
          value: value.trim(),
          type: 'string',
        },
      })
      return success({ marca: marca.trim(), modelo: value.trim() }, 201)
    }

    // Default: add brand
    const key = `${MARCA_PREFIX}${value.trim()}`
    const existing = await prisma.setting.findFirst({
      where: { company_id: user.companyId, key },
    })
    if (existing) return error('Marca ja cadastrada', 409)

    await prisma.setting.create({
      data: {
        company_id: user.companyId,
        key,
        value: value.trim(),
        type: 'string',
      },
    })
    return success({ marca: value.trim() }, 201)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const { type, marca, value } = body

    if (type === 'modelo' && marca && value) {
      const key = `${MODELO_PREFIX}${marca}.${value}`
      await prisma.setting.deleteMany({
        where: { company_id: user.companyId, key },
      })
      return success({ deleted: true })
    }

    if (type === 'marca' && value) {
      // Delete brand + all its models
      await prisma.setting.deleteMany({
        where: { company_id: user.companyId, key: { startsWith: `${MODELO_PREFIX}${value}.` } },
      })
      await prisma.setting.deleteMany({
        where: { company_id: user.companyId, key: `${MARCA_PREFIX}${value}` },
      })
      return success({ deleted: true })
    }

    return error('Parametros invalidos', 400)
  } catch (err) {
    return handleError(err)
  }
}
