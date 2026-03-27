import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { testarConexao } from '@/lib/nfse/focus-nfe'
import { z } from 'zod'

// ---------- GET: Get fiscal config for company ----------

export async function GET(_request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    let config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    // Create default config if not exists
    if (!config) {
      config = await prisma.fiscalConfig.create({
        data: {
          company_id: user.companyId,
          provider: 'focus_nfe',
          environment: 'homologacao',
          settings: {
            cnpj: '',
            inscricaoMunicipal: '',
            codigoMunicipio: '3550308',
            codigoServicoPadrao: '0107',
            aliquotaPadrao: 2.9,
          },
        },
      })
    }

    // Mask API key for security (show only last 4 chars)
    const safeConfig = {
      ...config,
      api_key: config.api_key
        ? `${'*'.repeat(Math.max(0, config.api_key.length - 4))}${config.api_key.slice(-4)}`
        : null,
      has_api_key: !!config.api_key,
    }

    return success(safeConfig)
  } catch (err) {
    return handleError(err)
  }
}

// ---------- PUT: Update fiscal config ----------

const updateConfigSchema = z.object({
  provider: z.string().optional(),
  api_key: z.string().optional(),
  environment: z.enum(['homologacao', 'producao']).optional(),
  settings: z.object({
    cnpj: z.string().optional(),
    inscricaoMunicipal: z.string().optional(),
    codigoMunicipio: z.string().optional(),
    codigoServicoPadrao: z.string().optional(),
    aliquotaPadrao: z.number().optional(),
  }).optional(),
})

export async function PUT(request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'emitir')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = updateConfigSchema.parse(body)

    // Load existing config or create
    let config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    const updateData: any = {}

    if (data.provider !== undefined) updateData.provider = data.provider
    if (data.environment !== undefined) updateData.environment = data.environment

    // Only update API key if a real value is provided (not masked)
    if (data.api_key && !data.api_key.includes('*')) {
      updateData.api_key = data.api_key
    }

    if (data.settings) {
      const currentSettings = (config?.settings && typeof config.settings === 'object')
        ? config.settings as Record<string, any>
        : {}

      const newSettings = { ...currentSettings }
      if (data.settings.cnpj !== undefined) newSettings.cnpj = data.settings.cnpj
      if (data.settings.inscricaoMunicipal !== undefined) newSettings.inscricaoMunicipal = data.settings.inscricaoMunicipal
      if (data.settings.codigoMunicipio !== undefined) newSettings.codigoMunicipio = data.settings.codigoMunicipio
      if (data.settings.codigoServicoPadrao !== undefined) newSettings.codigoServicoPadrao = data.settings.codigoServicoPadrao
      if (data.settings.aliquotaPadrao !== undefined) newSettings.aliquotaPadrao = data.settings.aliquotaPadrao

      updateData.settings = newSettings
    }

    updateData.updated_at = new Date()

    if (config) {
      config = await prisma.fiscalConfig.update({
        where: { company_id: user.companyId },
        data: updateData,
      })
    } else {
      config = await prisma.fiscalConfig.create({
        data: {
          company_id: user.companyId,
          provider: data.provider || 'focus_nfe',
          api_key: data.api_key && !data.api_key.includes('*') ? data.api_key : undefined,
          environment: data.environment || 'homologacao',
          settings: data.settings || {
            cnpj: '',
            inscricaoMunicipal: '',
            codigoMunicipio: '3550308',
            codigoServicoPadrao: '0107',
            aliquotaPadrao: 2.9,
          },
        },
      })
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'fiscal',
      action: 'config.update',
      newValue: {
        provider: config.provider,
        environment: config.environment,
        has_api_key: !!config.api_key,
      },
    })

    // Return with masked key
    const safeConfig = {
      ...config,
      api_key: config.api_key
        ? `${'*'.repeat(Math.max(0, config.api_key.length - 4))}${config.api_key.slice(-4)}`
        : null,
      has_api_key: !!config.api_key,
    }

    return success(safeConfig)
  } catch (err) {
    return handleError(err)
  }
}

// ---------- POST: Test connection ----------

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const { api_key, environment } = body

    // Use provided key or load from config
    let testKey = api_key
    let testEnv = environment

    if (!testKey || testKey.includes('*')) {
      const config = await prisma.fiscalConfig.findUnique({
        where: { company_id: user.companyId },
      })
      if (!config?.api_key) {
        return error('Nenhuma API key configurada para testar', 422)
      }
      testKey = config.api_key
      testEnv = testEnv || config.environment
    }

    const testResult = await testarConexao(testKey, testEnv || 'homologacao')

    return success(testResult)
  } catch (err) {
    return handleError(err)
  }
}
