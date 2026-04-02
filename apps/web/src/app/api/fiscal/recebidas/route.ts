import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { listarRecebidas, manifestar } from '@/lib/nfe/focus-nfe'
import { z } from 'zod'

// ---------- GET: Fetch NF-e recebidas from Focus NFe ----------

export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    if (!config?.api_key) {
      return error('API Key do Focus NFe nao configurada', 422)
    }

    const settings = (config.settings && typeof config.settings === 'object')
      ? config.settings as Record<string, any>
      : {}

    const cnpj = settings.cnpj
    if (!cnpj) {
      return error('CNPJ do emitente nao configurado. Configure em Fiscal > Configuracoes.', 422)
    }

    try {
      const recebidas = await listarRecebidas(
        cnpj,
        config.api_key,
        config.environment || undefined,
      )

      // Log the fetch
      await prisma.fiscalLog.create({
        data: {
          company_id: user.companyId,
          action: 'nfe.recebidas.listar',
          response: { count: recebidas.length } as any,
          status_code: 200,
        },
      }).catch(() => {})

      return success(recebidas)
    } catch (apiErr: any) {
      return error(`Erro ao buscar NF-e recebidas: ${apiErr.message}`, 502)
    }
  } catch (err) {
    return handleError(err)
  }
}

// ---------- POST: Register manifestacao ----------

const manifestacaoSchema = z.object({
  chave: z.string().length(44, 'Chave NF-e deve ter 44 digitos'),
  tipo: z.enum(['ciencia', 'confirmacao', 'desconhecimento', 'nao_realizada']),
  justificativa: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = manifestacaoSchema.parse(body)

    // Justificativa obrigatoria para desconhecimento e nao_realizada
    if (
      (data.tipo === 'desconhecimento' || data.tipo === 'nao_realizada') &&
      (!data.justificativa || data.justificativa.trim().length < 15)
    ) {
      return error('Justificativa obrigatoria (minimo 15 caracteres) para desconhecimento ou nao realizada', 422)
    }

    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    if (!config?.api_key) {
      return error('API Key do Focus NFe nao configurada', 422)
    }

    // Log the manifestation request
    await prisma.fiscalLog.create({
      data: {
        company_id: user.companyId,
        action: 'nfe.recebidas.manifestar.request',
        request: data as any,
      },
    }).catch(() => {})

    try {
      await manifestar(
        data.chave,
        data.tipo,
        config.api_key,
        config.environment || undefined,
        data.justificativa,
      )

      // Log success
      await prisma.fiscalLog.create({
        data: {
          company_id: user.companyId,
          action: 'nfe.recebidas.manifestar.success',
          response: { chave: data.chave, tipo: data.tipo } as any,
          status_code: 200,
        },
      }).catch(() => {})

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'fiscal',
        action: 'nfe.recebidas.manifestar',
        newValue: { chave: data.chave, tipo: data.tipo },
      })

      const tipoLabels: Record<string, string> = {
        ciencia: 'Ciencia da Operacao',
        confirmacao: 'Confirmacao da Operacao',
        desconhecimento: 'Desconhecimento da Operacao',
        nao_realizada: 'Operacao Nao Realizada',
      }

      return success({ message: `Manifestacao registrada: ${tipoLabels[data.tipo]}` })
    } catch (apiErr: any) {
      // Log error
      await prisma.fiscalLog.create({
        data: {
          company_id: user.companyId,
          action: 'nfe.recebidas.manifestar.error',
          response: { error: apiErr.message, chave: data.chave } as any,
          status_code: 502,
        },
      }).catch(() => {})

      return error(`Erro ao manifestar: ${apiErr.message}`, 502)
    }
  } catch (err) {
    return handleError(err)
  }
}
