import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { testarConexao } from '@/lib/nfse/focus-nfe'
import { encrypt, decrypt } from '@/lib/encryption'
import { z } from 'zod'

// ---------- GET: Get fiscal config for company ----------

export async function GET(_request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Fiscal config: only admin + financeiro (not atendente — sensitive data)
    if (user.roleName !== 'admin' && user.roleName !== 'financeiro') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
    }

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

    // Mask API key — mostrar últimos 4 chars do texto decriptado (não do texto encriptado)
    let maskedKey: string | null = null
    if (config.api_key) {
      try {
        const decrypted = decrypt(config.api_key)
        maskedKey = `${'*'.repeat(Math.max(0, decrypted.length - 4))}${decrypted.slice(-4)}`
      } catch {
        // Key em plaintext (migração pendente)
        maskedKey = `${'*'.repeat(Math.max(0, config.api_key.length - 4))}${config.api_key.slice(-4)}`
      }
    }
    // Strip sensitive fields — NEVER return certificate or password
    const { certificate_password, certificate_path, ...configWithoutSecrets } = config as any
    const settings = (configWithoutSecrets.settings && typeof configWithoutSecrets.settings === 'object')
      ? configWithoutSecrets.settings as Record<string, any>
      : {}
    const { certificate_base64, certificate_password: _settingsCertPwd, ...safeSettings } = settings

    const { api_key: _rawApiKey, ...configNoApiKey } = configWithoutSecrets as any
    const safeConfig = {
      ...configNoApiKey,
      settings: safeSettings,
      api_key_masked: maskedKey,
      has_api_key: !!config.api_key,
      certificate_uploaded: !!(certificate_path || certificate_base64 || settings.certificate_base64),
      certificate_filename: settings.certificate_filename || (config as any).certificate_filename || null,
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
    const result = await requirePermission('config', 'edit')
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

    // Encriptar API key antes de salvar
    if (data.api_key && !data.api_key.includes('*')) {
      updateData.api_key = encrypt(data.api_key)
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
          api_key: data.api_key && !data.api_key.includes('*') ? encrypt(data.api_key) : undefined,
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
    const result = await requirePermission('fiscal', 'view')
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
      // Decriptar API key armazenada
      try {
        testKey = decrypt(config.api_key)
      } catch {
        // Fallback: key pode estar em texto plano (migração)
        testKey = config.api_key
      }
      testEnv = testEnv || config.environment
    }

    const testResult = await testarConexao(testKey, testEnv || 'homologacao')

    return success(testResult)
  } catch (err) {
    return handleError(err)
  }
}
